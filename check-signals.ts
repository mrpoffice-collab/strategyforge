import prisma from './src/lib/prisma.js';

async function main() {
  const total = await prisma.screenerSignal.count();
  const unprocessed = await prisma.screenerSignal.count({ where: { processed: false } });

  // Price distribution
  const outOfRange = await prisma.screenerSignal.count({
    where: { OR: [{ price: { lt: 25 } }, { price: { gt: 100 } }, { price: null }] }
  });

  const inRange = await prisma.screenerSignal.count({
    where: { price: { gte: 25, lte: 100 } }
  });

  // By strategy
  const byStrategy = await prisma.screenerSignal.groupBy({
    by: ['strategyKey'],
    _count: true,
    orderBy: { _count: { strategyKey: 'desc' } }
  });

  // Date range
  const oldest = await prisma.screenerSignal.findFirst({ orderBy: { scannedAt: 'asc' }, select: { scannedAt: true } });
  const newest = await prisma.screenerSignal.findFirst({ orderBy: { scannedAt: 'desc' }, select: { scannedAt: true } });

  // Unique symbols
  const uniqueSymbols = await prisma.screenerSignal.findMany({ distinct: ['symbol'], select: { symbol: true } });

  console.log('=== Signal Analysis ===');
  console.log('Total signals:', total);
  console.log('Unprocessed:', unprocessed);
  console.log('Processed:', total - unprocessed);
  console.log('');
  console.log('In price range ($25-100):', inRange);
  console.log('Out of price range:', outOfRange);
  console.log('');
  console.log('Unique symbols:', uniqueSymbols.length);
  console.log('Date range:', oldest?.scannedAt, 'to', newest?.scannedAt);
  console.log('');
  console.log('By strategy:');
  byStrategy.forEach(s => console.log('  ' + s.strategyKey + ': ' + s._count));
}

main().catch(console.error).finally(() => prisma.$disconnect());
