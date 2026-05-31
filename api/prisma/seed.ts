import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  OrderStatus,
  ProjectDocumentKind,
  ProjectFlowStatus,
  SkyflowRole,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_HASH = bcrypt.hashSync('demo123', 10);

const PROJECT_SPECS: {
  id: string;
  name: string;
  totalItems: number;
  originalLength: number;
  status: OrderStatus;
  requirements: string;
}[] = [
  {
    id: 'proj-tower-north',
    name: 'מגדל צפון — אלומיניום קורות',
    totalItems: 24,
    originalLength: 620,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'פרופיל AL-620, ציפוי PVDF, התקנה עד קומה 18.',
  },
  {
    id: 'proj-campus-west',
    name: 'קמפוס מערב — ויטרינות הדבקה',
    totalItems: 18,
    originalLength: 550,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'זכוכית Low-E 8+16+8, מסגרות ברוחב מובנה.',
  },
  {
    id: 'proj-port-logistics',
    name: 'מרלו״ג נמל — שערים ציריים',
    totalItems: 40,
    originalLength: 480,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'כיסוי אלומיניום במפתן כפול, סיכה רוחבית.',
  },
  {
    id: 'proj-hospital-wing',
    name: 'ביה״ח — אגף חדש חזיתות',
    totalItems: 14,
    originalLength: 720,
    status: OrderStatus.ON_HOLD,
    requirements: 'חיפוי ACM + תאורת פס לד חיצונית.',
  },
  {
    id: 'proj-mall-atrium',
    name: 'קניון — חלון עוגן קומת כניסה',
    totalItems: 10,
    originalLength: 900,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'סנדוויץ׳ קורות חיזוק פנימי, ציר תלייה כבד.',
  },
  {
    id: 'proj-school-blocks',
    name: 'בית ספר — כיתות צפון',
    totalItems: 32,
    originalLength: 500,
    status: OrderStatus.COMPLETED,
    requirements: 'חלונות נפתחים עם רשת נגד יתושים.',
  },
  {
    id: 'flow-demo-from-scratch-001',
    name: 'דמו — זרימה מא׳ עד ת׳',
    totalItems: 12,
    originalLength: 600,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'פרויקט דמו לאימות זרימת תחנות.',
  },
  {
    id: 'flow-demo-line-b-002',
    name: 'דמו שני — קו ייצור B',
    totalItems: 8,
    originalLength: 550,
    status: OrderStatus.IN_PROGRESS,
    requirements: 'פרויקט דמו נוסף למסכים.',
  },
];

const STATION_NAMES_SHORT = [
  'מסורים',
  'CNC',
  'הרכבה',
  'הדבקות',
  'פינישים',
  'אריזה',
];

async function main() {
  await prisma.user.deleteMany();
  await prisma.projectDocument.deleteMany();
  await prisma.scrapReport.deleteMany();
  await prisma.stationLog.deleteMany();
  await prisma.projectOrder.deleteMany();

  const mgrFirst = [
    'דני',
    'מיכל',
    'אורן',
    'שירה',
    'תומר',
    'נועה',
    'רועי',
  ];
  const mgrLast = [
    'כהן',
    'לוי',
    'מזרחי',
    'אברהם',
    'גולן',
    'פרץ',
    'סגל',
  ];

  const usersData: {
    email: string;
    firstName: string;
    lastName: string;
    role: SkyflowRole;
    managedStationId?: number | null;
  }[] = [
    {
      email: 'admin@skyflow.local',
      firstName: 'מנהל',
      lastName: 'מערכת',
      role: SkyflowRole.ADMIN,
    },
    {
      email: 'planning@skyflow.local',
      firstName: 'תכנון',
      lastName: 'תפ״י',
      role: SkyflowRole.PLANNING,
    },
    {
      email: 'site.mgr@skyflow.local',
      firstName: 'מנהל',
      lastName: 'אתר',
      role: SkyflowRole.SITE_MANAGER,
      managedStationId: 7,
    },
    ...Array.from({ length: 7 }, (_, i) => ({
      email: `station${i + 1}.mgr@skyflow.local`,
      firstName: mgrFirst[i],
      lastName: mgrLast[i],
      role: SkyflowRole.STATION_MANAGER,
      managedStationId: i + 1,
    })),
    {
      email: 'demo.worker@skyflow.local',
      firstName: 'יוסי',
      lastName: 'הדגמה',
      role: SkyflowRole.WORKER,
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      email: `worker${i + 1}@skyflow.local`,
      firstName: 'עובד',
      lastName: `${i + 1}`,
      role: SkyflowRole.WORKER,
    })),
  ];

  for (const u of usersData) {
    await prisma.user.create({
      data: {
        email: u.email,
        passwordHash: DEMO_HASH,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        managedStationId: u.managedStationId ?? null,
      },
    });
  }

  const planningCreator = await prisma.user.findUnique({
    where: { email: 'planning@skyflow.local' },
    select: { id: true },
  });
  const demoCreatorId = planningCreator?.id ?? null;

  const older = new Date('2025-01-01T00:00:00.000Z');
  const now = new Date();

  for (let i = 0; i < PROJECT_SPECS.length; i++) {
    const p = PROJECT_SPECS[i];
    const updatedAt = i < 6 ? now : i === 7 ? older : now;
    await prisma.projectOrder.create({
      data: {
        id: p.id,
        name: p.name,
        totalItems: p.totalItems,
        requirements: p.requirements,
        status: p.status,
        flowStatus: ProjectFlowStatus.IN_PRODUCTION,
        originalLength: p.originalLength,
        createdByUserId: demoCreatorId,
        updatedAt,
        documents: {
          create: [
            {
              kind: ProjectDocumentKind.WORK_ORDER,
              title: `פקודת עבודה — ${p.name.slice(0, 24)}`,
              reference: `WO-${p.id.slice(-6).toUpperCase()}`,
              pdfPath: '/assets/project-docs/beyond-subframe-al1.pdf',
              sortOrder: 0,
            },
            {
              kind: ProjectDocumentKind.PURCHASE_ORDER,
              title: `הזמנת חומרים — ${p.name.slice(0, 24)}`,
              reference: `PO-${p.id.slice(-6).toUpperCase()}`,
              pdfPath: '/assets/project-docs/beyond-podium-material-order.pdf',
              sortOrder: 1,
            },
          ],
        },
      },
    });
  }

  /* תחנות 1–6 — דיווחים ופחת מגוונים לכל פרויקט (לא פרויקט 8 סנטימלי לפעמים) */
  for (const p of PROJECT_SPECS) {
    if (p.id.startsWith('flow-demo')) continue;
    for (let sid = 1; sid <= 6; sid++) {
      const qty = Math.max(
        1,
        Math.round((p.totalItems / 7) * (0.4 + sid * 0.08)),
      );
      await prisma.stationLog.create({
        data: {
          projectId: p.id,
          stationId: sid,
          processedQty: qty,
          issues:
            sid === 3 && p.id === 'proj-tower-north'
              ? 'בדיקת מידות נוספת בקומה 12'
              : null,
          cutLength: sid === 1 ? 580 + (p.totalItems % 7) * 2 : null,
        },
      });
      if (sid <= 4 && qty > 2) {
        await prisma.scrapReport.create({
          data: {
            projectId: p.id,
            stationId: sid,
            itemLength: 120 + sid * 15,
            scrapQty: Math.min(6, 1 + (qty % 4)),
          },
        });
      }
    }
  }

  /* עובד הדגמה — דיווחים עם workerId לביצועים במסך משתמשים */
  const demoWorker = await prisma.user.findUnique({
    where: { email: 'demo.worker@skyflow.local' },
  });
  if (demoWorker) {
    const demoProjects = PROJECT_SPECS.filter((p) => !p.id.startsWith('flow-demo'));
    const perfLogs: {
      projectId: string;
      stationId: number;
      processedQty: number;
      workerId: string;
      cutLength: number | null;
      issues: string | null;
      createdAt: Date;
    }[] = [];
    const seedNow = new Date();
    for (let dayOffset = -18; dayOffset <= 0; dayOffset++) {
      const base = new Date(seedNow);
      base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() + dayOffset);
      const n = dayOffset === 0 ? 5 : dayOffset === -1 ? 4 : 2;
      for (let r = 0; r < n; r++) {
        const p = demoProjects[(Math.abs(dayOffset) + r) % demoProjects.length]!;
        const sid = 1 + (r % 6);
        const at = new Date(base);
        at.setHours(8 + r * 2, 30, 0, 0);
        perfLogs.push({
          projectId: p.id,
          stationId: sid,
          processedQty: 3 + ((r + sid) % 6),
          workerId: demoWorker.id,
          cutLength: sid === 1 ? 600 : null,
          issues: dayOffset === 0 && r === 0 ? 'דיווח הדגמה' : null,
          createdAt: at,
        });
      }
    }
    await prisma.stationLog.createMany({ data: perfLogs });
  }

  /* דמו זרימה — קצת פחת בתחנות 1–3 */
  await prisma.scrapReport.createMany({
    data: [
      {
        projectId: 'flow-demo-from-scratch-001',
        stationId: 1,
        itemLength: 400,
        scrapQty: 2,
      },
      {
        projectId: 'flow-demo-from-scratch-001',
        stationId: 2,
        itemLength: 150,
        scrapQty: 4,
      },
      {
        projectId: 'flow-demo-line-b-002',
        stationId: 1,
        itemLength: 300,
        scrapQty: 3,
      },
    ],
  });

  console.log(
    'Seed OK:',
    PROJECT_SPECS.length,
    'projects,',
    usersData.length,
    'users (pw: demo123)',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
