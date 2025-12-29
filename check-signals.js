require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('./node_modules/.prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function check() {
  const signals = await prisma.screenerSignal.findMany({
    where: { processed: false },
    take: 30,
    orderBy: { scannedAt: 'desc' },
    select: { symbol: true, strategyKey: true, price: true }
  });

  console.log('=== PENDING SIGNALS (newest 30) ===');
  signals.forEach(s => {
    const valid = s.price && s.price >= 25 && s.price <= 100 ? '✓' : '✗';
    console.log(`${valid} ${s.symbol.padEnd(6)} ${s.strategyKey.padEnd(25)} $${s.price || 'NULL'}`);
  });

  const validCount = signals.filter(s => s.price && s.price >= 25 && s.price <= 100).length;
  console.log(`\nValid prices: ${validCount}/${signals.length}`);

  // Group by strategy
  const byStrategy = {};
  signals.forEach(s => {
    byStrategy[s.strategyKey] = (byStrategy[s.strategyKey] || 0) + 1;
  });
  console.log('\nBy strategy:');
  Object.entries(byStrategy).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  await prisma.$disconnect();
}
check();
