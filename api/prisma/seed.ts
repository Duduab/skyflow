import {
  PrismaClient,
  OrderStatus,
  ProjectDocumentKind,
} from '@prisma/client';

const prisma = new PrismaClient();

/**
 * דמו: שני פרויקטים ללא לוגים / פחת — התקדמות 0%, לבחירה במסך העמדה.
 * סדר יצירה + updatedAt: הפרויקט הראשי נשאר ראשון ב־GET /orders (updatedAt הכי חדש).
 */
async function main() {
  await prisma.projectDocument.deleteMany();
  await prisma.scrapReport.deleteMany();
  await prisma.stationLog.deleteMany();
  await prisma.projectOrder.deleteMany();

  const flowId = 'flow-demo-from-scratch-001';
  const secondId = 'flow-demo-line-b-002';
  const older = new Date('2025-01-01T00:00:00.000Z');
  const now = new Date();

  await prisma.projectOrder.create({
    data: {
      id: secondId,
      name: 'דמו שני — קו ייצור B (מאפס)',
      totalItems: 8,
      requirements:
        'פרויקט דמו נוסף: אין דיווחים. מתאים לבדיקת מעבר פרויקטים מהרשימה בטרמינל.',
      status: OrderStatus.IN_PROGRESS,
      originalLength: 550,
      updatedAt: older,
      documents: {
        create: [
          {
            kind: ProjectDocumentKind.WORK_ORDER,
            title: 'פקודת עבודה — תת־מסגרת AL1',
            reference: 'WO-BEYOND-AL1',
            pdfPath: '/assets/project-docs/beyond-subframe-al1.pdf',
            sortOrder: 0,
          },
          {
            kind: ProjectDocumentKind.PURCHASE_ORDER,
            title: 'הזמנת חומרים — פודיום',
            reference: 'PO-BEYOND-PODIUM',
            pdfPath: '/assets/project-docs/beyond-podium-material-order.pdf',
            sortOrder: 1,
          },
        ],
      },
    },
  });

  await prisma.projectOrder.create({
    data: {
      id: flowId,
      name: 'דמו — זרימה מא׳ עד ת׳ (הכל מאפס)',
      totalItems: 12,
      requirements:
        'פרויקט דמו: אין דיווחים קודמים. התחל בעמדה 1 והשלם ל־100% כדי לפתוח את הבאה.',
      status: OrderStatus.IN_PROGRESS,
      originalLength: 600,
      updatedAt: now,
      documents: {
        create: [
          {
            kind: ProjectDocumentKind.WORK_ORDER,
            title: 'פקודת עבודה — תת־מסגרת AL1',
            reference: 'WO-BEYOND-AL1',
            pdfPath: '/assets/project-docs/beyond-subframe-al1.pdf',
            sortOrder: 0,
          },
          {
            kind: ProjectDocumentKind.PURCHASE_ORDER,
            title: 'הזמנת חומרים — פודיום',
            reference: 'PO-BEYOND-PODIUM',
            pdfPath: '/assets/project-docs/beyond-podium-material-order.pdf',
            sortOrder: 1,
          },
        ],
      },
    },
  });

  console.log('Seed completed: 2 zero-state projects + PDF docs', flowId, secondId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
