-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM');

-- CreateEnum
CREATE TYPE "CapMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "category" "Category" NOT NULL,
    "number" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capAmountTop3" INTEGER,
    "capAmountTod3" INTEGER,
    "capAmountTop2" INTEGER,
    "capAmountBottom2" INTEGER,
    "capAmountRunTop" INTEGER,
    "capAmountRunBottom" INTEGER,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sumAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcessBuy" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" INTEGER,
    "batchId" INTEGER,

    CONSTRAINT "ExcessBuy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptSelf" (
    "id" SERIAL NOT NULL,
    "category" "Category" NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptSelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeWindow" (
    "id" SERIAL NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettleBatch" (
    "id" SERIAL NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapRule" (
    "id" SERIAL NOT NULL,
    "mode" "CapMode" NOT NULL DEFAULT 'MANUAL',
    "top3" INTEGER,
    "tod3" INTEGER,
    "top2" INTEGER,
    "bottom2" INTEGER,
    "runTop" INTEGER,
    "runBottom" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertTod3ToTop3" BOOLEAN NOT NULL DEFAULT false,
    "autoTop3" INTEGER,
    "autoTod3" INTEGER,
    "autoTop2" INTEGER,
    "autoBottom2" INTEGER,
    "autoRunTop" INTEGER,
    "autoRunBottom" INTEGER,
    "autoRecalcSeconds" INTEGER,
    "autoThresholdTop3" DECIMAL(14,2),
    "autoTop3Count" INTEGER,
    "autoBottom2Count" INTEGER,
    "autoRunBottomCount" INTEGER,
    "autoRunTopCount" INTEGER,
    "autoThresholdBottom2" DECIMAL(14,2),
    "autoThresholdRunBottom" DECIMAL(14,2),
    "autoThresholdRunTop" DECIMAL(14,2),
    "autoThresholdTod3" DECIMAL(14,2),
    "autoThresholdTop2" DECIMAL(14,2),
    "autoTod3Count" INTEGER,
    "autoTop2Count" INTEGER,
    "effectiveAtBottom2" TIMESTAMP(3),
    "effectiveAtRunBottom" TIMESTAMP(3),
    "effectiveAtRunTop" TIMESTAMP(3),
    "effectiveAtTod3" TIMESTAMP(3),
    "effectiveAtTop2" TIMESTAMP(3),
    "effectiveAtTop3" TIMESTAMP(3),

    CONSTRAINT "CapRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettleRun" (
    "id" SERIAL NOT NULL,
    "timeWindowId" INTEGER NOT NULL,
    "capMode" "CapMode" NOT NULL,
    "capTop3" INTEGER,
    "capTod3" INTEGER,
    "capTop2" INTEGER,
    "capBottom2" INTEGER,
    "capRunTop" INTEGER,
    "capRunBottom" INTEGER,
    "autoTop3" INTEGER,
    "autoTod3" INTEGER,
    "autoTop2" INTEGER,
    "autoBottom2" INTEGER,
    "autoRunTop" INTEGER,
    "autoRunBottom" INTEGER,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "totalSendToDealer" DECIMAL(14,2) NOT NULL,
    "totalKeepAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeSetting" (
    "id" SERIAL NOT NULL,
    "timeWindowId" INTEGER NOT NULL,
    "top3" VARCHAR(3) NOT NULL,
    "bottom2" VARCHAR(2) NOT NULL,
    "payoutTop3" INTEGER NOT NULL DEFAULT 600,
    "payoutTod3" INTEGER NOT NULL DEFAULT 100,
    "payoutTop2" INTEGER NOT NULL DEFAULT 70,
    "payoutBottom2" INTEGER NOT NULL DEFAULT 70,
    "payoutRunTop" INTEGER NOT NULL DEFAULT 3,
    "payoutRunBottom" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrizeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_approved_idx" ON "User"("approved");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_category_number_idx" ON "Product"("category", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Product_category_number_key" ON "Product"("category", "number");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_createdAt_idx" ON "OrderItem"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_createdAt_productId_idx" ON "OrderItem"("createdAt", "productId");

-- CreateIndex
CREATE INDEX "ExcessBuy_createdAt_idx" ON "ExcessBuy"("createdAt");

-- CreateIndex
CREATE INDEX "ExcessBuy_batchId_idx" ON "ExcessBuy"("batchId");

-- CreateIndex
CREATE INDEX "AcceptSelf_category_number_createdAt_idx" ON "AcceptSelf"("category", "number", "createdAt");

-- CreateIndex
CREATE INDEX "TimeWindow_startAt_endAt_idx" ON "TimeWindow"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettleRun_timeWindowId_key" ON "SettleRun"("timeWindowId");

-- CreateIndex
CREATE INDEX "SettleRun_createdAt_idx" ON "SettleRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeSetting_timeWindowId_key" ON "PrizeSetting"("timeWindowId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessBuy" ADD CONSTRAINT "ExcessBuy_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettleBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessBuy" ADD CONSTRAINT "ExcessBuy_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcessBuy" ADD CONSTRAINT "ExcessBuy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettleRun" ADD CONSTRAINT "SettleRun_timeWindowId_fkey" FOREIGN KEY ("timeWindowId") REFERENCES "TimeWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeSetting" ADD CONSTRAINT "PrizeSetting_timeWindowId_fkey" FOREIGN KEY ("timeWindowId") REFERENCES "TimeWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
