-- CreateTable
CREATE TABLE "PackagingObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "market" TEXT,
    "observedOn" DATETIME,
    "observedUntil" DATETIME,
    "netQuantity" REAL,
    "unit" TEXT,
    "multipackCount" INTEGER,
    "servingSize" TEXT,
    "nutritionBasis" TEXT,
    "evidenceImage" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'human',
    "notes" TEXT,
    "createdBy" TEXT,
    "publishedRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackagingObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "karma" INTEGER NOT NULL DEFAULT 0,
    "trustLevel" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'user',
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "id", "karma", "name", "passwordHash", "trustLevel", "updatedAt") SELECT "createdAt", "email", "id", "karma", "name", "passwordHash", "trustLevel", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("barcode", "brand", "createdAt", "id", "name", "updatedAt") SELECT "barcode", "brand", "createdAt", "id", "name", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE UNIQUE INDEX "Product_currentRevisionId_key" ON "Product"("currentRevisionId");
CREATE TABLE "new_ProductRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "submittedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "ingredients" TEXT NOT NULL,
    "servingSize" TEXT,
    "calories" REAL,
    "protein" REAL,
    "carbs" REAL,
    "sugars" REAL,
    "fat" REAL,
    "salt" REAL,
    "frontImage" TEXT,
    "ingredientsImage" TEXT,
    "nutritionImage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 2,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "changedFields" TEXT NOT NULL DEFAULT '[]',
    "autoNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" DATETIME,
    "sourceType" TEXT NOT NULL DEFAULT 'human',
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "importedAt" DATETIME,
    "licenseData" TEXT,
    "licenseImages" TEXT,
    "verifiedAt" DATETIME,
    "nutritionBasis" TEXT,
    "baseRevisionId" TEXT,
    "disputeStatus" TEXT,
    "disputeReason" TEXT,
    "disputeResolvedAt" DATETIME,
    "disputeResolvedById" TEXT,
    CONSTRAINT "ProductRevision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductRevision_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProductRevision" ("approvedCount", "autoNote", "brand", "calories", "carbs", "changedFields", "createdAt", "fat", "finalizedAt", "frontImage", "id", "ingredients", "ingredientsImage", "name", "nutritionImage", "productId", "protein", "rejectedCount", "requiredApprovals", "salt", "servingSize", "status", "submittedById", "sugars", "version") SELECT "approvedCount", "autoNote", "brand", "calories", "carbs", "changedFields", "createdAt", "fat", "finalizedAt", "frontImage", "id", "ingredients", "ingredientsImage", "name", "nutritionImage", "productId", "protein", "rejectedCount", "requiredApprovals", "salt", "servingSize", "status", "submittedById", "sugars", "version" FROM "ProductRevision";
DROP TABLE "ProductRevision";
ALTER TABLE "new_ProductRevision" RENAME TO "ProductRevision";
CREATE UNIQUE INDEX "ProductRevision_productId_version_key" ON "ProductRevision"("productId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

