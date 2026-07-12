import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 預先建立幾家已知選品店，方便之後擴充爬蟲 */
const shops = [
  { name: "ARKnets", url: "https://www.arknets.co.jp/" },
  { name: "diverse", url: "https://www.diverse-web.com/" },
  { name: "1LDK", url: "https://1ldkshop.com/" },
  { name: "LOFTMAN", url: "https://www.loftman.co.jp/" },
];

async function main(): Promise<void> {
  for (const shop of shops) {
    await prisma.shop.upsert({
      where: { name: shop.name },
      create: shop,
      update: { url: shop.url },
    });
  }
  console.log(`Seed 完成：${shops.length} 家選品店`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
