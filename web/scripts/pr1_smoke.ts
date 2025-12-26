#!/usr/bin/env node
/**
 * PR1 Smoke Test - Verify database tables exist and basic queries work
 *
 * Usage:
 *   set -a; source .env.local; set +a; npx tsx scripts/pr1_smoke.ts
 */

import { PrismaClient } from '@prisma/client';

const TIMEOUT_MS = 15000;
const EXPECTED_TABLES = [
  'Job',
  'JobEvent',
  'Task',
  'Artifact',
  'ArtifactCounter',
  'JobArtifactLatest'
];

async function main() {
  console.log('🔍 PR1 Smoke Test Starting...\n');

  // Check DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ FAIL: DATABASE_URL not set in environment');
    process.exit(1);
  }
  console.log('✓ DATABASE_URL found:', dbUrl.replace(/:[^:@]+@/, ':***@'));

  // Create Prisma client
  const prisma = new PrismaClient({
    log: ['error'],
  });

  let exitCode = 0;

  try {
    // Test 1: Connect and query table names
    console.log('\n📊 Querying pg_tables for table list...');
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const tableNames = tables.map(t => t.tablename);
    console.log('Found tables:', tableNames.join(', '));

    // Test 2: Verify expected tables exist
    console.log('\n🔎 Verifying expected tables...');
    const missing: string[] = [];

    for (const expectedTable of EXPECTED_TABLES) {
      const found = tableNames.includes(expectedTable);
      if (found) {
        console.log(`  ✓ ${expectedTable}`);
      } else {
        console.log(`  ✗ ${expectedTable} (MISSING)`);
        missing.push(expectedTable);
      }
    }

    if (missing.length > 0) {
      console.error(`\n❌ FAIL: Missing tables: ${missing.join(', ')}`);
      exitCode = 1;
    }

    // Test 3: Basic queries (if tables exist)
    if (missing.length === 0) {
      console.log('\n🧪 Testing basic queries...');

      // Count rows (should be 0 for fresh DB)
      const jobCount = await prisma.job.count();
      const taskCount = await prisma.task.count();
      const artifactCount = await prisma.artifact.count();

      console.log(`  Jobs: ${jobCount}`);
      console.log(`  Tasks: ${taskCount}`);
      console.log(`  Artifacts: ${artifactCount}`);

      // Test insert & query (idempotent - use fixed ID)
      const testJobId = '00000000-0000-0000-0000-000000000001';

      console.log('\n💾 Testing insert...');
      const job = await prisma.job.upsert({
        where: { id: testJobId },
        create: {
          id: testJobId,
          owner_user_id: 'smoke-test-user',
        },
        update: {},
      });
      console.log(`  ✓ Job created/found: ${job.id}`);

      // Test query with owner isolation
      const foundJob = await prisma.job.findFirst({
        where: {
          id: testJobId,
          owner_user_id: 'smoke-test-user',
        },
      });

      if (foundJob) {
        console.log(`  ✓ Owner isolation query works`);
      } else {
        console.error(`  ✗ Owner isolation query failed`);
        exitCode = 1;
      }

      // Test negative case (wrong owner)
      const wrongOwner = await prisma.job.findFirst({
        where: {
          id: testJobId,
          owner_user_id: 'wrong-user',
        },
      });

      if (!wrongOwner) {
        console.log(`  ✓ Owner isolation prevents cross-user access`);
      } else {
        console.error(`  ✗ Owner isolation failed (should return null)`);
        exitCode = 1;
      }
    }

    // Final verdict
    console.log('\n' + '='.repeat(50));
    if (exitCode === 0) {
      console.log('✅ PASS: All PR1 smoke tests passed');
    } else {
      console.log('❌ FAIL: Some tests failed');
    }
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

// Timeout wrapper
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Smoke test timed out after 15s')), TIMEOUT_MS);
});

Promise.race([main(), timeoutPromise]).catch((err) => {
  console.error('\n❌ FATAL:', err.message);
  process.exit(1);
});
