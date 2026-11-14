import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

async function runAxeCheck(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations,
    `Axe WCAG 2.2 AA violations on ${label}: ${JSON.stringify(results.violations, null, 2)}`,
  ).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `Horizontal overflow on ${contextLabel}: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth + 1);
}

test.describe('CrewSignal Website & Synthetic Demo E2E', () => {
  test('latest readings show a distinct text status in both themes and forced colors', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/demo');

    const badges = page.locator('.cs-readings .reading-status');
    await expect(badges).toHaveCount(6);
    await expect(page.getByRole('link', { name: 'Log mood', exact: true })).toHaveAccessibleDescription('No reference');
    await expect(page.getByRole('link', { name: 'Add blood glucose', exact: true })).toHaveAccessibleDescription('Not logged');

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const audit = await new AxeBuilder({ page }).include('.cs-readings').withRules(['color-contrast']).analyze();
      expect(audit.violations).toEqual([]);
      await assertNoHorizontalOverflow(page, `reading statuses in ${theme}`);
    }

    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.getByRole('link', { name: 'Log mood', exact: true })).toHaveAccessibleDescription('No reference');
    await page.goto('/demo/help');
    await expect(page.getByRole('heading', { name: 'Reading status legend' })).toBeVisible();
    await expect(page.locator('.reading-status-legend .reading-status')).toHaveCount(5);
  });

  test('1. Landing page uses local assets only, renders cleanly across themes/viewports, and passes WCAG 2.2 AA', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (!url.startsWith('http://127.0.0.1:4173')) {
          externalRequests.push(url);
        }
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Your observations\. A clearer next step\./i }),
    ).toBeVisible();
    await expect(page.getByText("SPACE APPS 2026 · POP N' SEB")).toBeVisible();
    expect(externalRequests).toEqual([]);

    // Open demo CTA is internal navigation without target="_blank"
    const openDemoLink = page.getByRole('link', { name: 'Open synthetic demo' }).first();
    await expect(openDemoLink).toHaveAttribute('href', '/demo');
    await expect(openDemoLink).not.toHaveAttribute('target', '_blank');

    const landingBrandBox = await page
      .getByRole('link', { name: 'CrewSignal' })
      .first()
      .boundingBox();
    expect(landingBrandBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.locator('body').innerText()).not.toContain('`');

    await assertNoHorizontalOverflow(page, 'Landing 1440px');
    await runAxeCheck(page, 'Landing Light');

    // Switch to Dark mode and verify theme + axe-core
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await runAxeCheck(page, 'Landing Dark');

    // 320px narrow reflow check
    await page.setViewportSize({ width: 320, height: 640 });
    await assertNoHorizontalOverflow(page, 'Landing 320px');

    // 400% zoom equivalent layout (320px CSS viewport)
    await page.setViewportSize({ width: 320, height: 256 });
    await assertNoHorizontalOverflow(page, 'Landing 400% zoom viewport');
  });

  test('2. Full primary browser journey: Overview -> Check-in BP -> Trends -> Explorer -> Actions -> Sources -> Reports download & print', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('link', { name: 'Open synthetic demo' }).first().click();

    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('5 of 6 indicator types logged')).toBeVisible();
    await expect(page.getByText('118/76 mmHg · 07:07')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /5h 48m · 1h 36m below reference/i }),
    ).toBeVisible();

    await runAxeCheck(page, 'Overview Light');

    // Keyboard-only navigation: Skip link Tab + Enter moves focus to main content
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    // Navigate Overview -> Check-in and commit optional Day 42 07:18 BP 118/76
    await page.getByRole('link', { name: 'Start check-in' }).click();
    await expect(page).toHaveURL(/\/demo\/check-in/);

    await page.getByLabel('Systolic (mmHg)').fill('118');
    await page.getByLabel('Diastolic (mmHg)').fill('76');
    await page.getByLabel('Observed mission day').fill('42');
    await page.getByLabel('Observed time (UTC HH:MM)').fill('07:18');
    await page.getByLabel('Measurement method').selectOption('Manual cuff');
    await page.getByLabel('Measurement context').selectOption('At rest');

    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByRole('heading', { name: 'Blood pressure' })).toBeVisible();
    await expect(page.getByText('118/76 mmHg')).toBeVisible();

    await page.getByRole('button', { name: 'Add to log' }).click();
    await expect(page.getByRole('heading', { name: 'Added to your log' })).toBeVisible();
    await expect(page.getByText('Stored on this device', { exact: true })).toBeVisible();

    // Return to Overview: total count goes 11 -> 12, coverage stays 5 of 6, latest BP shows 07:18
    await page.getByRole('link', { name: 'Back to overview' }).click();
    await expect(page.getByText('12 total entries')).toBeVisible();
    await expect(page.getByText('5 of 6 indicator types logged')).toBeVisible();
    await expect(page.getByText('118/76 mmHg · 07:18')).toBeVisible();

    // Navigate to Trends: 7-day, 30-day gap banner, accessible table toggle
    await page.getByRole('link', { name: 'Trends', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/trends/);
    await page.getByRole('button', { name: '30-day' }).click();
    await expect(page.getByText('No entries · days 13–35 (23 gap days)')).toBeVisible();
    await page.getByRole('button', { name: 'View data table' }).click();
    await expect(page.getByRole('table').first()).toBeVisible();

    // Navigate to Explorer: interactive 2D Body SVG + all 5 systems
    await page.getByRole('link', { name: 'Explorer', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/explorer/);
    await expect(page.getByText('Not a medical scan')).toBeVisible();
    await page.getByRole('button', { name: 'Inspect Cardiovascular' }).click();
    await expect(page.getByRole('heading', { name: 'Cardiovascular' })).toBeVisible();
    await page.getByRole('tab', { name: 'Musculoskeletal' }).click();
    await expect(page.getByText('No indicators tracked in this prototype')).toBeVisible();
    await page.getByRole('tab', { name: 'Immune context' }).click();
    await expect(page.getByText(/Context only; do not infer immune status/i)).toBeVisible();
    await runAxeCheck(page, 'Explorer Light');

    // Navigate to Actions & internal Sources navigation
    await page.getByRole('link', { name: 'Actions', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/actions/);
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByText('Reviewed for current version')).toBeVisible();
    await page.getByRole('link', { name: /View source: NASA sleep & schedules/i }).click();
    await expect(page).toHaveURL(/\/demo\/sources\/nasa-sleep-risk/);
    await expect(page.getByText('Available offline: summary')).toBeVisible();
    await expect(page.getByRole('link', { name: /View original source/i })).toHaveAttribute(
      'target',
      '_blank',
    );

    // Navigate to Reports: verify 11 observations across 4 types & actual downloaded file bytes
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/reports/);
    await expect(
      page.getByRole('heading', { name: /Report preview \(11 observations across 4 types\)/i }),
    ).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download report JSON' }).click(),
    ]);
    await expect(page.getByText('Download requested', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').getByText(/Check your Downloads/)).toBeVisible();

    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const rawJson = await fs.readFile(filePath!, 'utf-8');
    const parsed = JSON.parse(rawJson) as {
      kind: string;
      totalObservations: number;
      includedTypesCount: number;
      includeNotes: boolean;
      includedMetricIds: string[];
    };
    expect(parsed.kind).toBe('crewsignal-report');
    expect(parsed.totalObservations).toBe(11);
    expect(parsed.includedTypesCount).toBe(4);
    expect(parsed.includeNotes).toBe(false);
    expect(parsed.includedMetricIds).not.toContain('mood');
  });

  test('unusual blood pressure saves the entered pair after confirmation', async ({ page }) => {
    await page.goto('/demo/check-in');
    await page.getByLabel('Systolic (mmHg)').fill('80');
    await page.getByLabel('Diastolic (mmHg)').fill('120');
    await page.getByLabel('Observed time (UTC HH:MM)').fill('07:18');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByText(/Systolic is equal to or below diastolic/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and add to log' }).click();
    await expect(page.getByRole('heading', { name: 'Added to your log' })).toBeVisible();
    await expect(page.getByText('80/120 mmHg', { exact: true })).toBeVisible();
    await expect(page.getByText('Unusual value confirmed as entered.')).toBeVisible();
  });

  test('3. Measurement forms, unusual-value review, unit conversion modal, and theme switching preserve inputs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo/check-in');

    // Reversed BP reaches review with a warning and can be edited without losing inputs.
    await page.getByLabel('Systolic (mmHg)').fill('80');
    await page.getByLabel('Diastolic (mmHg)').fill('120');
    await page.getByLabel('Observed time (UTC HH:MM)').fill('07:18');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(
      page.getByText(/Systolic is equal to or below diastolic/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm and add to log' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.getByLabel('Observed time (UTC HH:MM)')).toHaveValue('07:18');
    await expect(page.getByLabel('Diastolic (mmHg)')).toHaveValue('120');

    // Appearance toggle in place preserves route AND unsaved inputs!
    await page.getByRole('button', { name: /Appearance: Dark/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveURL(/\/demo\/check-in/);
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('80');
    await expect(page.getByLabel('Diastolic (mmHg)')).toHaveValue('120');
    await runAxeCheck(page, 'Check-in Dark with validation state');

    // Switch to Blood glucose -> test populated unit-change confirmation modal
    await page.getByRole('tab', { name: 'Blood glucose' }).click();
    await page.getByLabel('Input unit').selectOption('mmol/L');
    await page.getByLabel('Blood glucose reading').fill('5.4');

    // Attempting unit change with populated field opens confirmation modal focused on Cancel
    await page.getByLabel('Input unit').selectOption('mg/dL');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Escape cancels, preserves 5.4, restores focus to <select>
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
    await expect(page.getByLabel('Blood glucose reading')).toHaveValue('5.4');
    await expect(page.getByLabel('Input unit')).toBeFocused();

    // Confirming Clear value and change unit clears field and changes unit
    await page.getByLabel('Input unit').selectOption('mg/dL');
    await page.getByRole('button', { name: 'Clear value and change unit' }).click();
    await expect(page.getByLabel('Blood glucose reading')).toHaveValue('');
    await expect(page.getByLabel('Input unit')).toHaveValue('mg/dL');

    // Test MF-02 conversion preview (5.4 mmol/L -> exact 97.308 mg/dL)
    await page.getByLabel('Input unit').selectOption('mmol/L');
    await page.getByLabel('Blood glucose reading').fill('5.4');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByText(/97\.308 mg\/dL/)).toBeVisible();
    await expect(page.getByText(/A compatible method is not known/i)).toBeVisible();

    // Return to Record and check Heart rate (MF-01), Body temp (MF-03), Sleep 0h 0m (MF-04) & Mood unselected default (MF-05)
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await page.getByLabel('Heart rate (bpm)').fill('68');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByText('68 bpm')).toBeVisible();

    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByRole('tab', { name: 'Temperature' }).click();
    await page.getByLabel('Body temperature reading').fill('37.0');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(page.getByText(/98\.6 °F/)).toBeVisible();

    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByRole('tab', { name: 'Sleep' }).click();
    await page.getByLabel('Hours asleep').fill('0');
    await page.getByLabel('Minutes (0–59)').fill('0');
    await expect(page.getByText(/Reported no sleep for this period/i)).toBeVisible();

    await page.getByRole('tab', { name: 'Mood' }).click();
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await expect(
      page.getByRole('alert').getByText(/Choose a rating, or choose another reading/i),
    ).toBeVisible();
  });

  test('4. ER-02, ER-04, C08 SW update deferral, C09 unconfirmed, 5-row CSV reconciliation & personal rejection', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo/settings');

    // Open fault simulation drawer
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();

    // 1. Test C08 update prompt deferred while uncommitted draft exists (SPA navigation keeps in-memory QA toggle)
    await page.getByLabel('Simulate SW update waiting (C08)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/check-in/);
    await page.getByLabel('Systolic (mmHg)').fill('119');
    await page.getByRole('button', { name: 'Update ready' }).click();
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Later' })).toBeFocused();
    await expect(modal.getByRole('button', { name: 'Install now' })).toBeDisabled();
    await modal.getByRole('button', { name: 'Later' }).click();

    // 2. Test ER-04 draft write failure ("Only on this screen" + DraftRecoveryBundle download)
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate draft retention failure (ER-04)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await page.getByLabel('Systolic (mmHg)').fill('121');
    await expect(page.getByText('Only on this screen')).toBeVisible();
    const [recoveryDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download recovery JSON' }).click(),
    ]);
    const recPath = await recoveryDl.path();
    const recJson = JSON.parse(await fs.readFile(recPath!, 'utf-8')) as {
      kind: string;
      uncommitted: boolean;
    };
    expect(recJson.kind).toBe('crewsignal-draft-recovery');
    expect(recJson.uncommitted).toBe(true);

    // 3. Test ER-02 atomic commit rollback keeps draft intact
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate draft retention failure (ER-04)').uncheck();
    await page.getByLabel('Simulate commit failure / rollback (ER-02)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await page.getByLabel('Systolic (mmHg)').fill('122');
    await page.getByLabel('Diastolic (mmHg)').fill('78');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('button', { name: 'Add to log' }).click();
    await expect(page.getByText(/Your draft is preserved/i)).toBeVisible();

    // 4. Test C09 unconfirmed outcome ("Addition unconfirmed" -> "Check the log")
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate commit failure / rollback (ER-02)').uncheck();
    await page.getByLabel('Simulate lost commit acknowledgement').check();
    await page.getByLabel('Simulate unconfirmed verification read (C09)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await expect(page.getByText('122/78 mmHg')).toBeVisible();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Systolic (mmHg)').fill('123');
    await page.getByLabel('Diastolic (mmHg)').fill('79');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('button', { name: 'Add to log' }).click();
    await expect(page.getByRole('heading', { name: 'Addition unconfirmed' })).toBeVisible();
    await expect(page.getByText(/Check the log for this entry before adding again/i)).toBeVisible();

    // 5. Reset demo cleanly & test 5-row CSV reconciliation in Settings
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    const resetDialog = page.getByRole('alertdialog');
    await expect(resetDialog.getByRole('button', { name: 'Keep demo' })).toBeFocused();
    await resetDialog.getByRole('button', { name: 'Reset demo data', exact: true }).click();

    await page.getByRole('button', { name: 'Load 5-row review fixture' }).click();
    await expect(
      page.getByText(/2 valid · 1 duplicate · 1 conflict · 1 rejected/i),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Use imported whole entry' }).check();
    await page
      .getByRole('checkbox', {
        name: /Acknowledge excluded\/rejected\/duplicate rows/i,
      })
      .check();
    await page.getByRole('button', { name: 'Commit reviewed CSV batch' }).click();
    await expect(page.getByText(/Imported CSV batch: 2 added, 1 updated, 2 skipped/i)).toBeVisible();

    // 6. Reject personal-mode backup file on upload
    const personalBackup = {
      kind: 'crewsignal-backup',
      schemaVersion: 1,
      exportedAtUtc: '2026-11-13T07:30:00Z',
      confirmedFullProfileData: true,
      profile: {
        profileId: 'personal-01',
        label: 'Personal Crew',
        alias: null,
        mode: 'personal',
        scenarioId: null,
        missionName: 'Personal Log',
        missionEpochUtc: '2026-11-13T00:00:00Z',
        displayTimezone: 'UTC',
        snapshotUtc: null,
        createdAtUtc: '2026-11-13T00:00:00Z',
        clockVersion: 1,
        schedules: {
          heart_rate: null,
          blood_pressure: null,
          blood_glucose: null,
          body_temperature: null,
          sleep: null,
          mood: null,
        },
      },
      preferences: {
        appearance: 'system',
        activeProfileId: 'personal-01',
        displayUnits: { blood_glucose: 'mg/dL', body_temperature: 'C' },
        helpMode: 'unconfigured',
      },
      observations: [],
      checkInEvents: [],
      references: [],
      insights: [],
      summaryCounts: {
        observationCount: 0,
        moodCount: 0,
        noteCount: 0,
        eventCount: 0,
        referenceCount: 0,
      },
    };
    const tmpBackupPath = path.join(
      test.info().outputDir,
      'personal-backup-reject.json',
    );
    await fs.mkdir(path.dirname(tmpBackupPath), { recursive: true });
    await fs.writeFile(tmpBackupPath, JSON.stringify(personalBackup), 'utf-8');
    await page
      .locator('label', { hasText: 'Inspect backup file to restore' })
      .locator('input[type="file"]')
      .setInputFiles(tmpBackupPath);
    await expect(
      page.getByText(/Personal-mode backups cannot be restored into the public synthetic demonstration/i),
    ).toBeVisible();
  });

  test('5. SPA history fallback reload, responsive viewports (Phone 390x844, Tablet 768x1024, 320px), and offline SW reload', async ({
    page,
    context,
  }) => {
    // Wait for SW control on /demo
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo');
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return false;
            const reg = await navigator.serviceWorker.ready;
            return Boolean(reg.active);
          }),
        { timeout: 15000 },
      )
      .toBe(true);

    // Direct deep-link reload verification
    await page.goto('/demo/sources/nasa-sleep-risk');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /Risk from Inadequate Sleep and Irregular Schedules/i }),
    ).toBeVisible();

    // Reload once on /demo so SW controls client, then test genuine offline reload!
    await page.goto('/demo');
    await page.reload();
    await context.setOffline(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();

    await page.goto('/demo/help');
    await expect(
      page.getByRole('heading', { name: 'Mission-specific guidance not configured' }),
    ).toBeVisible();

    await context.setOffline(false);

    // Tablet 768x1024 compact labelled rail & zero horizontal overflow
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/demo');
    await assertNoHorizontalOverflow(page, 'Overview Tablet 768px');

    // Phone 390x844 5-tab bottom bar + More hub
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo');
    await assertNoHorizontalOverflow(page, 'Overview Phone 390px');
    await page.getByRole('link', { name: 'More', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/more/);
    await expect(page.getByRole('link', { name: /Settings/i })).toBeVisible();

    // Narrow 320px reflow + 200% text scaling check across /demo/reports & /demo/check-in
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/demo/reports');
    await assertNoHorizontalOverflow(page, 'Reports 320px');
    await page.goto('/demo/check-in');
    await assertNoHorizontalOverflow(page, 'Check-in 320px');

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/demo');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await assertNoHorizontalOverflow(page, 'Overview 1280px at 200% text scale');
  });

  test('6. Regression verification (#25): pill radius, backtick cleanup, Tablet/Phone axe & targets, metric switching, and schedule/empty mission day', async ({
    page,
  }) => {
    // 1. Light badge radius = 6px and zero literal backticks across demo surfaces
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo');
    const pillRadius = await page
      .locator('.cs-pill')
      .first()
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(pillRadius).toBe('6px');

    for (const route of ['/demo/trends', '/demo/actions', '/demo/settings']) {
      await page.goto(route);
      expect(
        await page.locator('body').innerText(),
        `Literal backtick found on ${route}`,
      ).not.toContain('`');
    }

    // 2. Tablet 768x1024 compact rail target & axe-core on Overview + Reports
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/demo');
    const tabletBrandBox = await page
      .getByRole('link', { name: /CrewSignal/i })
      .first()
      .boundingBox();
    expect(tabletBrandBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(tabletBrandBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await runAxeCheck(page, 'Overview Tablet 768px');

    await page.goto('/demo/reports');
    await runAxeCheck(page, 'Reports Tablet 768px');

    // 3. Phone 390x844 Reports axe-core + keyboard-accessible scrollable table region
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/reports');
    const reportsTableWrap = page.getByRole('region', {
      name: 'Report preview observations table',
    });
    await expect(reportsTableWrap).toHaveAttribute('tabindex', '0');
    await runAxeCheck(page, 'Reports Phone 390px');

    // 4. Check-in metric switching after MF-04 & ?metric=sleep + banner suppression on /demo/check-in
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo/check-in');
    await page.getByLabel('Load synthetic fixture').selectOption('MF-04');
    await expect(page.getByLabel('Hours asleep')).toHaveValue('5');
    await expect(page.getByLabel('Minutes (0–59)')).toHaveValue('48');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await expect(page.getByLabel('Heart rate (bpm)')).toBeVisible();

    await page.goto('/demo/check-in?metric=sleep');
    await expect(page.getByLabel('Hours asleep')).toBeVisible();
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await expect(page.getByLabel('Heart rate (bpm)')).toBeVisible();
    await page.getByLabel('Heart rate (bpm)').fill('72');
    await expect(page.getByText('Draft kept on this device')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Resume draft' })).toHaveCount(0);

    await page.goto('/demo');
    await expect(page.getByRole('link', { name: 'Resume draft' })).toBeVisible();

    // 5. SIM-SCHEDULE overdue schedule & SIM-EMPTY Mission day 1
    await page.goto('/demo/settings');
    await page.getByRole('button', { name: 'SIM-SCHEDULE (Schedule example)' }).click();
    await page.goto('/demo');
    await expect(page.getByText('Configured schedule status')).toBeVisible();
    await expect(page.getByText(/Overdue · 26h 18m since last entry/i)).toBeVisible();

    await page.goto('/demo/settings');
    await page.getByRole('button', { name: 'SIM-EMPTY (Empty scenario)' }).click();
    await page.goto('/demo');
    await expect(page.getByText(/SIM-EMPTY · Unlogged scenario · Mission day 1/)).toBeVisible();
    await expect(page.getByText('0 of 6 indicator types logged')).toBeVisible();
    await expect(page.getByText('No observations logged yet')).toBeVisible();
  });
  test('7. Review P1 regressions: consecutive check-ins from Overview get distinct drafts, and drafts survive navigation and metric changes', async ({
    page,
  }) => {
    const totalEntries = page.locator('p.cs-helper').filter({ hasText: 'total entries' });

    // Two consecutive check-ins started from Overview: 11 -> 12 -> 13 (review repro).
    await page.goto('/demo');
    await expect(totalEntries).toContainText('(11 total entries)');
    for (const [sys, dia, time, expected] of [
      ['119', '77', '07:17', 12],
      ['123', '79', '07:18', 13],
    ] as const) {
      await page.getByRole('link', { name: 'Start check-in' }).first().click();
      await page.getByLabel('Systolic (mmHg)').fill(sys);
      await page.getByLabel('Diastolic (mmHg)').fill(dia);
      await page.getByLabel('Observed mission day').fill('42');
      await page.getByLabel('Observed time (UTC HH:MM)').fill(time);
      await page.getByRole('button', { name: 'Next: Review' }).click();
      await page.getByRole('button', { name: 'Add to log' }).click();
      await expect(page.getByRole('heading', { name: 'Added to your log' })).toBeVisible();
      await expect(page.getByText('Already in your log')).toHaveCount(0);
      await page.getByRole('link', { name: 'Back to overview' }).first().click();
      await expect(totalEntries).toContainText(`(${expected} total entries)`);
    }
    await expect(page.getByText('Last log entry:')).toContainText('123/79');

    // Retained draft survives Overview, a metric switch and return, and a reload.
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await page.getByLabel('Systolic (mmHg)').fill('127');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByText('Draft kept on this device')).toBeVisible();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('127');
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await page.getByLabel('Heart rate (bpm)').fill('66');
    await page.getByRole('tab', { name: 'Blood pressure' }).click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('127');
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await expect(page.getByLabel('Heart rate (bpm)')).toHaveValue('66');
    await page.reload();
    await expect(page.getByLabel('Heart rate (bpm)')).toHaveValue('66');

    // Memory-only draft (ER-04): survives in-app navigation and metric switches,
    // defers the app update, guards unload, and reset offers export or discard.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate draft retention failure (ER-04)').check();
    await page.getByLabel('Simulate SW update waiting (C08)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await page.getByRole('tab', { name: 'Blood pressure' }).click();
    await page.getByLabel('Systolic (mmHg)').fill('131');
    await expect(page.getByText('Only on this screen')).toBeVisible();
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByText('Draft only in this tab')).toBeVisible();
    await page.getByRole('link', { name: 'Resume draft' }).click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('131');
    await page.getByRole('tab', { name: 'Heart rate' }).click();
    await page.getByRole('tab', { name: 'Blood pressure' }).click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('131');

    await page.getByRole('button', { name: 'Update ready' }).click();
    const updateModal = page.getByRole('alertdialog');
    await expect(updateModal.getByRole('button', { name: 'Install now' })).toBeDisabled();
    await updateModal.getByRole('button', { name: 'Later' }).click();

    const unloadGuarded = await page.evaluate(() => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(unloadGuarded).toBe(true);

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Reset demo/i }).first().click();
    const resetModal = page.getByRole('alertdialog');
    await expect(resetModal.getByText('Unsaved draft would be lost')).toBeVisible();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      resetModal.getByRole('button', { name: 'Download recovery JSON' }).click(),
    ]);
    const recovered = JSON.parse(await fs.readFile((await dl.path())!, 'utf-8')) as {
      draft: { rawFields: { primary: string } };
    };
    expect(recovered.draft.rawFields.primary).toBe('131');
    await resetModal.getByRole('button', { name: 'Keep demo' }).click();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('131');
  });
  test('8. Review P2: Check-in and Explorer tabs follow the W3C keyboard pattern', async ({ page }) => {
    await page.goto('/demo/check-in');
    const metricList = page.getByRole('tablist', { name: 'Observation metrics' });
    const bp = metricList.getByRole('tab', { name: 'Blood pressure' });
    const glucose = metricList.getByRole('tab', { name: 'Blood glucose' });
    await expect(bp).toHaveAttribute('aria-selected', 'true');
    // Only the selected tab is in the Tab order.
    await expect(metricList.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

    // Manual activation: arrows move focus without switching the measurement
    // (switching goes through draft protection).
    await bp.focus();
    await page.keyboard.press('ArrowRight');
    await expect(glucose).toBeFocused();
    await expect(bp).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Systolic (mmHg)')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(glucose).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await glucose.getAttribute('id') ?? '');
    await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Blood glucose' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(metricList.getByRole('tab', { name: 'Mood' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(metricList.getByRole('tab', { name: 'Heart rate' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(metricList.getByRole('tab', { name: 'Heart rate' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(metricList.getByRole('tab', { name: 'Mood' })).toBeFocused();

    // Explorer: automatic activation, selection follows focus.
    await page.getByRole('link', { name: 'Explorer', exact: true }).click();
    const systems = page.getByRole('tablist', { name: 'All five body systems' });
    const sleepTab = systems.getByRole('tab', { name: 'Sleep & cognition' });
    const cardioTab = systems.getByRole('tab', { name: 'Cardiovascular' });
    await expect(sleepTab).toHaveAttribute('aria-selected', 'true');
    await sleepTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(cardioTab).toBeFocused();
    await expect(cardioTab).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', await cardioTab.getAttribute('id') ?? '');
    await expect(panel.getByRole('heading', { name: 'Cardiovascular' })).toBeVisible();
    await runAxeCheck(page, 'Explorer after keyboard tab change');
  });
  test('9. Review P2: calmer Overview puts the next step first and joins readings 2x3 / 3x2 / 6-rail', async ({ page }) => {
    const columns = () =>
      page
        .locator('.cs-readings')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const cases: Array<[number, number, number]> = [
      [390, 844, 2],
      [768, 1024, 3],
      [1440, 900, 6],
      [320, 700, 1],
    ];
    for (const [width, height, expected] of cases) {
      await page.setViewportSize({ width, height });
      await page.goto('/demo');
      await expect(page.locator('.cs-readings > li')).toHaveCount(6);
      await expect.poll(columns, { message: `${width}px readings columns` }).toBe(expected);
      // Sleep comparison is stated once on the page.
      await expect(page.getByText(/1h 36m below reference/)).toHaveCount(1);
      // Missing glucose shows "Not recorded" with an Add action.
      await expect(page.getByRole('link', { name: 'Add blood glucose' })).toBeVisible();
      const doc = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(doc, `${width}px no horizontal scroll`).toBe(true);
    }
    // Phone: compact check-in and the next step come before the readings.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo');
    const order: number[] = [];
    for (const loc of [
      page.getByRole('main').getByRole('link', { name: 'Start check-in' }),
      page.locator('#sleep-focus-heading'),
      page.locator('.cs-readings'),
      page.locator('#sleep-chart-heading'),
    ]) {
      order.push((await loc.boundingBox())!.y);
    }
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Desktop: chart and next step sit beneath the six-reading rail.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo');
    const rail = await page.locator('.cs-readings').boundingBox();
    const chart = await page.locator('.cs-overview-chart').boundingBox();
    const next = await page.locator('.cs-overview-next').boundingBox();
    expect(chart!.y).toBeGreaterThan(rail!.y + rail!.height - 1);
    expect(Math.abs(chart!.y - next!.y)).toBeLessThan(2);
    // Overview chart uses the agreed 0/5/10-hour scale.
    await expect(page.locator('.cs-overview-chart svg text').filter({ hasText: /^10h$/ })).toHaveCount(1);
    const ticks = await page.locator('.cs-overview-chart svg text').allTextContents();
    expect(ticks.filter((t) => /h$/.test(t))).toEqual(['0h', '5h', '10h']);
    await runAxeCheck(page, 'Calmer Overview desktop');
  });
  test('10. Review P2: landing page has a phone menu, team entry, planned platforms and credits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Landing navigation' });
    for (const name of ['Project', 'Evidence', 'Team']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
    await expect(page.getByText('Manual entry · Local processing · Offline after initial setup.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View this data in the demo' })).toHaveAttribute('href', '/demo/trends');
    await expect(page.getByText('Available · synthetic demo')).toBeVisible();
    await expect(page.getByText('Planned', { exact: true })).toHaveCount(2);
    const team = page.getByRole('link', { name: 'Team entry on spaceappschallenge.org' });
    await expect(team).toHaveAttribute(
      'href',
      'https://www.spaceappschallenge.org/2026/find-a-team/pop-n-seb-phases-of-the-moon-never-separated-beneath/',
    );
    await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible();
    for (const term of ['Research', 'Data', 'Fonts', 'Libraries', 'Tool assistance', 'Licence']) {
      await expect(page.locator('#credits dt', { hasText: term })).toHaveCount(1);
    }
    // Evidence comes before limits; limits say no fitness-for-duty assessment.
    await expect(page.locator('#limits')).toContainText('fitness for duty');
    const evidenceFirst = await page.evaluate(() => {
      const evidence = document.querySelector('#evidence .cs-card')!;
      const limits = document.querySelector('#limits')!;
      return Boolean(evidence.compareDocumentPosition(limits) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(evidenceFirst).toBe(true);
    await runAxeCheck(page, 'Landing P2 desktop');

    // Phone: anchors and appearance sit behind a labelled Menu button.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveAttribute('aria-controls', 'landing-menu');
    await expect(nav).toBeHidden();
    await expect(page.getByRole('link', { name: 'Open demo', exact: true })).toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Appearance' })).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Landing menu 320px');
    await runAxeCheck(page, 'Landing P2 phone menu open');
    await nav.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('11. Review P1 (re-review): a saved draft behind an unconfirmed outcome is never reopened; the next check-in starts blank and adds one entry', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const totalEntries = page.locator('p.cs-helper').filter({ hasText: 'total entries' });
    await page.goto('/demo');
    await expect(totalEntries).toContainText('(11 total entries)');

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate lost commit acknowledgement').check();
    await page.getByLabel('Simulate unconfirmed verification read (C09)').check();
    await page.getByRole('link', { name: 'Check-in', exact: true }).click();
    await page.getByLabel('Systolic (mmHg)').fill('128');
    await page.getByLabel('Diastolic (mmHg)').fill('82');
    await page.getByLabel('Observed mission day').fill('42');
    await page.getByLabel('Observed time (UTC HH:MM)').fill('07:18');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('button', { name: 'Add to log' }).click();
    await expect(page.getByRole('heading', { name: 'Addition unconfirmed' })).toBeVisible();
    // Recoverable: checking again while reads fail keeps the outcome and its action.
    await page.getByRole('button', { name: 'Check stored log' }).click();
    await expect(page.getByRole('heading', { name: 'Addition unconfirmed' })).toBeVisible();

    // Reads work again. The entry was written, so Overview counts it once.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByText(/Recovery, Help fixture & fault simulation controls/i).click();
    await page.getByLabel('Simulate lost commit acknowledgement').uncheck();
    await page.getByLabel('Simulate unconfirmed verification read (C09)').uncheck();
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(totalEntries).toContainText('(12 total entries)');

    // The saved 128/82 draft is not offered again: Check-in starts blank.
    await page.getByRole('link', { name: 'Start check-in' }).first().click();
    await expect(page.getByLabel('Systolic (mmHg)')).toHaveValue('');
    await page.getByLabel('Systolic (mmHg)').fill('132');
    await page.getByLabel('Diastolic (mmHg)').fill('84');
    await page.getByLabel('Observed mission day').fill('42');
    await page.getByLabel('Observed time (UTC HH:MM)').fill('07:19');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('button', { name: 'Add to log' }).click();
    await expect(page.getByRole('heading', { name: 'Added to your log' })).toBeVisible();
    await expect(page.getByText('Already in your log')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to overview' }).first().click();
    await expect(totalEntries).toContainText('(13 total entries)');
    await expect(page.getByText('Last log entry:')).toContainText('132/84');
  });
});
