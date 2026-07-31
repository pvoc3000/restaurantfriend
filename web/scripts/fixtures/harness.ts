// A test harness small enough to read in one sitting, and with no dependency
// this repo doesn't already have.
//
// The app has no test runner by design so far, and adding vitest/jest to run a
// few dozen assertions over four pure modules would be the larger change. This
// compiles the modules under test to CommonJS with the TypeScript that is
// already installed and runs the assertions in plain Node — see
// scripts/fixtures/tsconfig.json and `npm run fixtures`.

type Case = { name: string; run: () => void };

const cases: Case[] = [];

export function test(name: string, run: () => void) {
  cases.push({ name, run });
}

export function eq<T>(actual: T, expected: T, what = "value") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

export function ok(value: unknown, what = "condition") {
  if (!value) throw new Error(`${what}: expected truthy, got ${JSON.stringify(value)}`);
}

export function no(value: unknown, what = "condition") {
  if (value) throw new Error(`${what}: expected falsy, got ${JSON.stringify(value)}`);
}

export function runAll(): void {
  let passed = 0;
  const failures: string[] = [];
  for (const c of cases) {
    try {
      c.run();
      passed += 1;
    } catch (e) {
      failures.push(`  ✗ ${c.name}\n      ${(e as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    console.error(`\n${passed} passed, ${failures.length} FAILED (${cases.length} cases)`);
    process.exit(1);
  }
  console.log(`${passed} passed (${cases.length} cases)`);
}
