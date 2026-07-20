import { mkdirSync } from 'fs';
import { join } from 'path';

/** PDFs attached to projects — served as static files from the web app. */
export function ensureProjectDocsUploadDir(): string {
  const dir = join(
    process.cwd(),
    '..',
    'web',
    'public',
    'assets',
    'project-docs',
    'uploads',
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** תמונות מסורים לאחר אישור — מוגשות מ־`web/public/planning-saws/{projectId}/` */
export function ensureSawPlanningCaptureDir(projectId: string): string {
  return join(
    process.cwd(),
    '..',
    'web',
    'public',
    'planning-saws',
    projectId,
  );
}
