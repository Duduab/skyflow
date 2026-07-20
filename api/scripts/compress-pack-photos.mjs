/**
 * Phase 3 (performance audit) — one-time cleanup of old, heavy pack-photo
 * images (worker uploads from before client-side compression existed, some
 * up to 6-7MB). Re-encodes anything above a size threshold to a resized JPEG
 * and updates any `PackReportPhoto.imagePath` rows whose extension changes.
 *
 * SAFE BY DEFAULT: runs as a dry run (report only) unless `--confirm` is
 * passed. Every touched original is copied to a timestamped backup folder
 * before it is modified/replaced, so a bad run can always be undone.
 *
 * Usage (run from `api/`, after `npm run build`):
 *   node scripts/compress-pack-photos.mjs                # dry run, prints a report
 *   node scripts/compress-pack-photos.mjs --confirm       # actually rewrites files + DB
 *   node scripts/compress-pack-photos.mjs --confirm --min-kb=300 --max-dimension=1800 --quality=85
 */
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join, extname, basename } from 'node:path';
import { mapWithConcurrency } from '../dist/src/common/concurrency.util.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const CONFIRM = args.has('confirm');
const MIN_BYTES = Number(args.get('min-kb') ?? 200) * 1024;
const MAX_DIMENSION = Number(args.get('max-dimension') ?? 1600);
const QUALITY = Number(args.get('quality') ?? 82);
const CONCURRENCY = Number(args.get('concurrency') ?? 4);

const PACK_PHOTOS_DIR = join(process.cwd(), '..', 'web', 'public', 'assets', 'pack-photos');
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;

function backupDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(process.cwd(), 'backups', `pack-photos-${stamp}`);
}

async function processFile(filePath, backupDirPath) {
  const size = statSync(filePath).size;
  if (size < MIN_BYTES) return null;

  const original = basename(filePath);
  const ext = extname(original).toLowerCase();
  const jpegName =
    ext === '.jpg' || ext === '.jpeg' ? original : original.slice(0, -ext.length) + '.jpg';
  const changesExtension = jpegName !== original;

  const image = sharp(filePath);
  const meta = await image.metadata();
  const scale = Math.min(1, MAX_DIMENSION / Math.max(meta.width ?? MAX_DIMENSION, meta.height ?? MAX_DIMENSION));
  const targetWidth = Math.max(1, Math.round((meta.width ?? MAX_DIMENSION) * scale));

  const outputBuffer = await image
    .resize({ width: targetWidth, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();

  const saved = size - outputBuffer.length;
  if (saved <= 0) {
    return { original, skipped: true, reason: 'no size reduction', before: size, after: size };
  }

  if (!CONFIRM) {
    return { original, jpegName, before: size, after: outputBuffer.length, saved, dryRun: true };
  }

  mkdirSync(backupDirPath, { recursive: true });
  copyFileSync(filePath, join(backupDirPath, original));

  const outputPath = join(PACK_PHOTOS_DIR, jpegName);
  await sharp(outputBuffer).toFile(outputPath);
  if (changesExtension) unlinkSync(filePath);

  return {
    original,
    jpegName,
    changesExtension,
    before: size,
    after: outputBuffer.length,
    saved,
  };
}

async function main() {
  if (!existsSync(PACK_PHOTOS_DIR)) {
    console.log(`No pack-photos directory at ${PACK_PHOTOS_DIR} — nothing to do.`);
    return;
  }
  const files = readdirSync(PACK_PHOTOS_DIR).filter((f) => IMAGE_EXT_RE.test(f));
  console.log(
    `Scanning ${files.length} image(s) in ${PACK_PHOTOS_DIR} (threshold ${(MIN_BYTES / 1024).toFixed(0)}KB, ${
      CONFIRM ? 'CONFIRM — will write changes' : 'DRY RUN — no files/DB will be touched'
    })`,
  );

  const dir = backupDir();
  const results = await mapWithConcurrency(files, CONCURRENCY, (f) =>
    processFile(join(PACK_PHOTOS_DIR, f), dir).catch((err) => ({
      original: f,
      error: err instanceof Error ? err.message : String(err),
    })),
  );

  const touched = results.filter((r) => r && !r.skipped && !r.error);
  const failed = results.filter((r) => r && r.error);
  const totalSaved = touched.reduce((sum, r) => sum + (r.saved ?? 0), 0);

  for (const r of touched) {
    console.log(
      `  ${r.original} -> ${r.jpegName ?? r.original}: ${(r.before / 1024).toFixed(0)}KB -> ${(
        r.after / 1024
      ).toFixed(0)}KB (saved ${(r.saved / 1024).toFixed(0)}KB)${r.dryRun ? ' [dry run]' : ''}`,
    );
  }
  for (const r of failed) {
    console.error(`  FAILED ${r.original}: ${r.error}`);
  }

  console.log(
    `\n${touched.length} file(s) ${CONFIRM ? 'compressed' : 'would be compressed'}, ` +
      `${failed.length} failed, total ${CONFIRM ? 'saved' : 'estimated savings'}: ${(totalSaved / 1024 / 1024).toFixed(2)}MB`,
  );

  if (!CONFIRM) {
    console.log('\nDry run only — re-run with --confirm to write changes (backups saved first).');
    return;
  }

  // Repoint any PackReportPhoto rows whose file extension changed (PNG -> JPEG).
  const renamed = touched.filter((r) => r.changesExtension);
  if (renamed.length) {
    const prisma = new PrismaClient();
    try {
      for (const r of renamed) {
        const oldPath = `/assets/pack-photos/${r.original}`;
        const newPath = `/assets/pack-photos/${r.jpegName}`;
        const { count } = await prisma.packReportPhoto.updateMany({
          where: { imagePath: oldPath },
          data: { imagePath: newPath },
        });
        if (count) console.log(`  DB updated ${count} row(s): ${oldPath} -> ${newPath}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(`\nBackups of originals saved to: ${dir}`);
}

await main();
