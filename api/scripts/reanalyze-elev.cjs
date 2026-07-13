const { PrismaClient } = require('@prisma/client');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { renderElevation } = require('../dist/src/elevation/elevation-render.js');

const prisma = new PrismaClient();
const WEB_PUBLIC = join(__dirname, '..', '..', 'web', 'public');
const CODE_RE = /\b(\d{2}-\d-\d{2}[A-Z]?)\b/;

function extractCode(code, items) {
  const d = CODE_RE.exec(code || '');
  if (d) return d[1];
  for (const it of items || []) {
    const m = CODE_RE.exec(String(it));
    if (m) return m[1];
  }
  return null;
}

(async () => {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('usage: reanalyze-elev <projectId>');
    process.exit(1);
  }
  const maps = await prisma.elevationMap.findMany({
    where: { projectId },
    include: { document: { select: { pdfPath: true, title: true } } },
  });
  console.log(`project ${projectId}: ${maps.length} map(s)`);

  for (const map of maps) {
    const pdfPath = map.document?.pdfPath;
    if (!pdfPath) {
      console.log(`  map ${map.id} (${map.facadeGroup}): no pdfPath, skip`);
      continue;
    }
    const file = join(WEB_PUBLIC, pdfPath.replace(/^\//, ''));
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      console.log(`  map ${map.id}: file missing ${file}, skip`);
      continue;
    }
    const rendered = await renderElevation(buf);
    const dir = join(process.cwd(), 'storage', 'elevation-maps', map.id);
    mkdirSync(dir, { recursive: true });
    const pages = [];
    for (const page of rendered.pages) {
      const fileName = `page-${page.pageIndex}.png`;
      writeFileSync(join(dir, fileName), page.pngBuffer);
      pages.push({
        pageIndex: page.pageIndex,
        imageUrl: `/api/elevation-maps/${map.id}/${fileName}`,
        width: page.width,
        height: page.height,
        sections: page.sections,
      });
    }
    const cellRows = rendered.pages.flatMap((page) =>
      page.cells.map((c) => ({
        mapId: map.id,
        pageIndex: page.pageIndex,
        code: (c.code || '').slice(0, 64),
        floor: c.floor,
        kind: c.kind,
        items: c.items,
        bbox: c.bbox,
        status: 'PENDING',
        windowTypeCode: extractCode(c.code, c.items),
      })),
    );
    await prisma.elevationCell.deleteMany({ where: { mapId: map.id } });
    if (cellRows.length)
      await prisma.elevationCell.createMany({ data: cellRows });
    await prisma.elevationMap.update({
      where: { id: map.id },
      data: { status: 'READY', pageCount: rendered.pageCount, pages },
    });
    console.log(
      `  map ${map.id} (${map.facadeGroup}) → ${cellRows.length} cells, ${pages.length} page(s)`,
    );
  }

  // link windowTypeId where a matching WindowType exists
  const wts = await prisma.windowType.findMany({
    where: { projectId },
    select: { id: true, code: true },
  });
  const codeToId = new Map(wts.map((w) => [w.code, w.id]));
  const cells = await prisma.elevationCell.findMany({
    where: { map: { projectId }, windowTypeCode: { not: null } },
    select: { id: true, windowTypeCode: true },
  });
  let linked = 0;
  for (const c of cells) {
    const id = codeToId.get(c.windowTypeCode);
    if (id) {
      await prisma.elevationCell.update({
        where: { id: c.id },
        data: { windowTypeId: id },
      });
      linked++;
    }
  }
  console.log(`linked ${linked}/${cells.length} cells to window types`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
