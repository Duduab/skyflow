/**
 * עובד הדגמה + דיווחי עמדות לביצועים במסך משתמשים.
 * לא מוחק משתמשים/פרויקטים — בטוח להרצה על DB קיים.
 *
 * התחברות: demo.worker@skyflow.local / demo123
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient, SkyflowRole } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo.worker@skyflow.local';
const DEMO_PASSWORD = 'demo123';

async function main() {
  const projects = await prisma.projectOrder.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 6,
    select: { id: true, name: true },
  });

  if (!projects.length) {
    console.error(
      'אין פרויקטים ב-DB. הריצו קודם: npm run prisma:seed (מתוך api/)',
    );
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const worker = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      firstName: 'יוסי',
      lastName: 'הדגמה',
      role: SkyflowRole.WORKER,
      managedStationId: null,
    },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      firstName: 'יוסי',
      lastName: 'הדגמה',
      role: SkyflowRole.WORKER,
    },
  });

  const removed = await prisma.stationLog.deleteMany({
    where: { workerId: worker.id },
  });

  const now = new Date();
  const logs: {
    projectId: string;
    stationId: number;
    processedQty: number;
    workerId: string;
    issues: string | null;
    cutLength: number | null;
    createdAt: Date;
  }[] = [];

  for (let dayOffset = -20; dayOffset <= 0; dayOffset++) {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + dayOffset);

    const reportsToday =
      dayOffset === 0 ? 6 : dayOffset === -1 ? 5 : 1 + (Math.abs(dayOffset) % 4);

    for (let r = 0; r < reportsToday; r++) {
      const project = projects[(Math.abs(dayOffset) + r) % projects.length]!;
      const stationId = 1 + ((r + dayOffset) % 6);
      const at = new Date(base);
      at.setHours(7 + r * 2, 20 + r * 11, 0, 0);

      logs.push({
        projectId: project.id,
        stationId,
        processedQty: 2 + ((r + dayOffset) % 7) + (stationId % 3),
        workerId: worker.id,
        issues:
          dayOffset === 0 && r === 1
            ? 'בדיקת מידות — אושר'
            : dayOffset === -3 && r === 0
              ? 'הערת איכות קלה'
              : null,
        cutLength: stationId === 1 ? 580 + (r % 5) * 12 : null,
        createdAt: at,
      });
    }
  }

  await prisma.stationLog.createMany({ data: logs });

  console.log('');
  console.log('✓ עובד הדגמה מוכן לביצועים במסך משתמשים');
  console.log('  שם:     יוסי הדגמה');
  console.log(`  מייל:   ${DEMO_EMAIL}`);
  console.log(`  סיסמה:  ${DEMO_PASSWORD}`);
  console.log(`  דיווחים: ${logs.length} (הוסרו קודמים: ${removed.count})`);
  console.log(`  פרויקטים: ${projects.map((p) => p.name).join(', ')}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
