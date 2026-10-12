const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const reservationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator(value) {
          try {
            const amount = new Decimal(value.toString());
            return amount.isFinite() && amount.greaterThan(0);
          } catch {
            return false;
          }
        },
        message: "Reservation amount must be greater than zero.",
      },
    },
    currency: {
      type: String,
      enum: ["USD"],
      default: "USD",
      required: true,
    },
    status: {
      type: String,
      enum: ["held", "released", "consumed"],
      default: "held",
      required: true,
      index: true,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

reservationSchema.index(
  { wallet: 1, createdAt: -1 },
  { name: "wallet_reservation_history" },
);

reservationSchema.index(
  { user: 1, status: 1, createdAt: -1 },
  { name: "user_reservation_status" },
);

module.exports = mongoose.model("WalletReservation", reservationSchema);
