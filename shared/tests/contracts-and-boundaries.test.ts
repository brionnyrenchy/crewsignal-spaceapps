import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BackupBundleSchema,
  EVIDENCE_REGISTRY,
  METRIC_DEFINITIONS,
  MEASUREMENT_EDUCATION_SECTIONS,
  MetricDefinitionSchema,
  CANONICAL_ACCEPTANCE_VECTORS,
  DraftRecoveryBundleSchema,
  EXAMPLE_BACKUP_BUNDLE,
  EXAMPLE_DRAFT_RECOVERY_BUNDLE,
  EXAMPLE_REPORT_BUNDLE,
  MF_FIXTURES,
  ObservationSchema,
  PersonalReferenceSchema,
  ProfileConfigSchema,
  ReportBundleSchema,
  SIM_01_OBSERVATIONS,
  SIM_01_PROFILE,
  SIM_01_REFERENCES,
  SIM_EMPTY_PROFILE,
  SIM_SCHEDULE_OBSERVATIONS,
  SIM_SCHEDULE_PROFILE,
  THEME_TOKENS,
  CSV_REVIEW_FIXTURE_CSV,
  generateCsvTemplate,
} from '../src/index';

const SHARED_ROOT = path.resolve(import.meta.dirname, '..');

describe('source/shared runtime boundary & asset integrity', () => {
  it('contains zero browser, Tauri, React Native, or Node runtime imports inside src/', () => {
    const srcDir = path.join(SHARED_ROOT, 'src');
    const files = fs
      .readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(srcDir, f));

    expect(files.length).toBeGreaterThanOrEqual(9);

    const forbiddenPatterns = [
      /from\s+['"]node:/,
      /from\s+['"](fs|path|crypto|os|url|child_process|http|https)['"]/,
      /from\s+['"]@tauri-apps/,
      /from\s+['"]react-native/,
      /from\s+['"]expo/,
      /\brequire\s*\(/,
      /\b(localStorage|sessionStorage|indexedDB)\b/,
      /\b(?:window|document|navigator)\s*(?:\.\s*[A-Za-z_$]|\[)/,
      /\btypeof\s+(?:window|document|navigator)\b/,
      /\bglobalThis\.(?:window|document|navigator)\b/,
    ];

    for (const filePath of files) {
      const text = fs.readFileSync(filePath, 'utf8');
      for (const rx of forbiddenPatterns) {
        expect(text, `Forbidden import/global ${rx} in ${path.basename(filePath)}`).not.toMatch(rx);
      }
    }
  });

  it('validates all canonical fixtures against strict Zod schemas', () => {
    expect(ProfileConfigSchema.parse(SIM_01_PROFILE)).toBeTruthy();
    expect(ProfileConfigSchema.parse(SIM_SCHEDULE_PROFILE)).toBeTruthy();
    expect(ProfileConfigSchema.parse(SIM_EMPTY_PROFILE)).toBeTruthy();

    expect(SIM_01_OBSERVATIONS).toHaveLength(11);
    for (const obs of SIM_01_OBSERVATIONS) {
      expect(ObservationSchema.parse(obs)).toBeTruthy();
    }
    for (const obs of SIM_SCHEDULE_OBSERVATIONS) {
      expect(ObservationSchema.parse(obs)).toBeTruthy();
    }
    for (const ref of SIM_01_REFERENCES) {
      expect(PersonalReferenceSchema.parse(ref)).toBeTruthy();
    }
    expect(ReportBundleSchema.parse(EXAMPLE_REPORT_BUNDLE)).toBeTruthy();
    expect(BackupBundleSchema.parse(EXAMPLE_BACKUP_BUNDLE)).toBeTruthy();
    expect(
      DraftRecoveryBundleSchema.parse(EXAMPLE_DRAFT_RECOVERY_BUNDLE),
    ).toBeTruthy();
    expect(MF_FIXTURES).toHaveLength(5);
  });

  it('links all three explanations for each metric to its registered evidence', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(SHARED_ROOT, 'fixtures/evidence-and-help.json'), 'utf8'));
    for (const metric of Object.values(METRIC_DEFINITIONS)) {
      expect(MetricDefinitionSchema.parse(metric)).toEqual(fixture.metricDefinitions[metric.id]);
      for (const { field } of MEASUREMENT_EDUCATION_SECTIONS) {
        const { sourceId } = metric[field];
        expect(metric.evidenceIds).toContain(sourceId);
        expect(EVIDENCE_REGISTRY[sourceId]?.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('maintains parity between TypeScript exports and generated JSON/CSV fixture & token files', () => {
    const readJson = (rel: string) =>
      JSON.parse(fs.readFileSync(path.join(SHARED_ROOT, rel), 'utf8'));

    expect(readJson('tokens/tokens.json')).toEqual(THEME_TOKENS);
    expect(readJson('fixtures/canonical-vectors.json')).toEqual(
      CANONICAL_ACCEPTANCE_VECTORS,
    );
    expect(readJson('fixtures/example-report.json')).toEqual(EXAMPLE_REPORT_BUNDLE);
    expect(readJson('fixtures/example-backup.json')).toEqual(EXAMPLE_BACKUP_BUNDLE);
    expect(readJson('fixtures/example-draft-recovery.json')).toEqual(
      EXAMPLE_DRAFT_RECOVERY_BUNDLE,
    );
    expect(
      fs.readFileSync(
        path.join(SHARED_ROOT, 'fixtures/csv-review-fixture.csv'),
        'utf8',
      ),
    ).toBe(CSV_REVIEW_FIXTURE_CSV);
    expect(
      fs.readFileSync(path.join(SHARED_ROOT, 'fixtures/csv-template.csv'), 'utf8'),
    ).toBe(generateCsvTemplate());

    const tokensCss = fs.readFileSync(
      path.join(SHARED_ROOT, 'tokens/tokens.css'),
      'utf8',
    );
    expect(tokensCss).toContain('#08090a');
    expect(tokensCss).toContain('#e4f222');
    expect(tokensCss).toContain('#fafafa');
    expect(tokensCss).toContain('#171717');
    expect(tokensCss).toContain('InterVariable.woff2');
    expect(tokensCss).toContain('GeistMono-Variable.woff2');

    // Typography size custom properties must not collide with --text-body / --text-supporting color vars
    expect(tokensCss).toContain('--text-size-metadata:');
    expect(tokensCss).toContain('--text-size-supporting:');
    expect(tokensCss).toContain('--text-size-body:');
    expect(tokensCss).toContain('--text-size-panel-heading:');
    expect(tokensCss).toContain('--text-size-value:');
    expect(tokensCss).not.toMatch(/--text-body:\s*1rem/);
    expect(tokensCss).not.toMatch(/--text-supporting:\s*0\.875rem/);
    expect(tokensCss).toMatch(/--text-body:\s*#d0d6e0/);
    expect(tokensCss).toMatch(/--text-supporting:\s*#8a8f98/);
  });

  it('bundles Inter & Geist Mono fonts (woff2 + ttf) and OFL licenses matching FONT-MANIFEST.json', () => {
    const fontsDir = path.join(SHARED_ROOT, 'assets', 'fonts');
    const manifestRaw = fs
      .readFileSync(path.join(fontsDir, 'FONT-MANIFEST.json'), 'utf8')
      .replace(/^\uFEFF/, '');
    const manifest = JSON.parse(manifestRaw) as {
      files: Array<{ file: string; bytes: number; sha256: string }>;
    };

    const requiredFiles = [
      'InterVariable.woff2',
      'InterVariable.ttf',
      'Inter-Regular.ttf',
      'Inter-Medium.ttf',
      'Inter-SemiBold.ttf',
      'Inter-OFL-LICENSE.txt',
      'GeistMono-Variable.woff2',
      'GeistMono-Variable.ttf',
      'GeistMono-Regular.ttf',
      'GeistMono-Medium.ttf',
      'GeistMono-SemiBold.ttf',
      'GeistMono-OFL-LICENSE.txt',
    ];

    for (const fileName of requiredFiles) {
      const full = path.join(fontsDir, fileName);
      expect(fs.existsSync(full), `Missing font/license asset ${fileName}`).toBe(
        true,
      );
      expect(fs.statSync(full).size).toBeGreaterThan(1000);
    }

    for (const entry of manifest.files) {
      if (entry.file === 'FONT-MANIFEST.json') continue;
      const full = path.join(fontsDir, entry.file);
      const buf = fs.readFileSync(full);
      const actualHash = crypto
        .createHash('sha256')
        .update(buf)
        .digest('hex')
        .toUpperCase();
      expect(buf.length).toBe(entry.bytes);
      expect(actualHash).toBe(entry.sha256.toUpperCase());
    }
  });
});
