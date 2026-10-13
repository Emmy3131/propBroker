require("dotenv").config();

const mongoose = require("mongoose");

async function fixDepositCreditReferenceIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URL);

    const db = mongoose.connection.db;
    const collection = db.collection("deposits");

    console.log("Connected to MongoDB.");

    const indexes = await collection.indexes();

    const oldIndex = indexes.find(
      (index) => index.name === "creditReference_1",
    );

    if (oldIndex) {
      console.log("Existing index:", oldIndex);

      await collection.dropIndex("creditReference_1");

      console.log("Old creditReference_1 index dropped.");
    }

    await collection.createIndex(
      { creditReference: 1 },
      {
        unique: true,
        name: "creditReference_1",
        partialFilterExpression: {
          creditReference: { $type: "string" },
        },
      },
    );

    console.log("Corrected creditReference_1 index created.");

    const updatedIndexes = await collection.indexes();

    console.log(
      updatedIndexes.find((index) => index.name === "creditReference_1"),
    );
  } catch (error) {
    console.error("Index migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

fixDepositCreditReferenceIndex();
