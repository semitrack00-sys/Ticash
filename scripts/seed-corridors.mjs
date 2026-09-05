import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const candidates = ['MONCASH', 'NATCASH'].map((payoutMethod) => ({
  sendCountry: 'US',
  sourceCurrency: 'USD',
  receiveCountry: 'HT',
  targetCurrency: 'HTG',
  fundingProvider: 'DWOLLA',
  payoutMethod,
  enabledForSandbox: false,
  approvedForLiveUse: false,
  fundingProviderApproved: false,
  payoutProviderApproved: false,
  regulatoryApproved: false,
}));

try {
  for (const candidate of candidates) {
    await prisma.corridorConfig.upsert({
      where: {
        sendCountry_sourceCurrency_receiveCountry_targetCurrency_fundingProvider_payoutMethod: {
          sendCountry: candidate.sendCountry,
          sourceCurrency: candidate.sourceCurrency,
          receiveCountry: candidate.receiveCountry,
          targetCurrency: candidate.targetCurrency,
          fundingProvider: candidate.fundingProvider,
          payoutMethod: candidate.payoutMethod,
        },
      },
      update: {},
      create: candidate,
    });
  }
  console.log('Seeded disabled U.S.-to-Haiti Dwolla corridor candidates.');
} finally {
  await prisma.$disconnect();
}
