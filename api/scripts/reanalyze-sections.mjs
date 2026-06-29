import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ElevationService } from '../dist/src/elevation/elevation.service.js';

const prisma = new PrismaClient();
const svc = new ElevationService(prisma);

const maps = await prisma.elevationMap.findMany({
  include: { document: true },
  orderBy: { createdAt: 'desc' },
});

console.log(`Found ${maps.length} elevation map(s)`);
const seenDocs = new Set();
for (const m of maps) {
  if (!m.document || seenDocs.has(m.documentId)) continue;
  seenDocs.add(m.documentId);
  const rel = m.document.pdfPath.replace(/^\//, '');
  const abs = join(process.cwd(), '..', 'web', 'public', rel);
  console.log(`Re-analyzing doc ${m.documentId} (${m.title}) -> ${abs}`);
  try {
    const fileBuffer = readFileSync(abs);
    await svc.analyzeDocument({
      projectId: m.projectId,
      documentId: m.documentId,
      title: m.title,
      fileBuffer,
    });
    console.log('  done');
  } catch (e) {
    console.error('  failed:', String(e));
  }
}

await prisma.$disconnect();
