
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    // =========================================================
    // BASIC PROFILE
    // =========================================================

    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Please provide an email address"],
      unique: true,
      lowercase: true,
      trim: true,
      // index: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address",
      ],
    },

    phone: {
      type: String,
      trim: true,
      default: null,
    },

    country: {
      type: String,
      trim: true,
      default: null,
    },

    profileImage: {
      type: String,
      default: null,
    },

    // =========================================================
    // AUTHENTICATION
    // =========================================================

    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "active",
        "suspended",
        "blocked",
        "closed",
      ],
      default: "pending",
      // index: true,
    },

    // =========================================================
    // EMAIL VERIFICATION
    // =========================================================

    emailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationToken: {
      type: String,
      select: false,
    },

    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    // =========================================================
    // PASSWORD RESET
    // =========================================================

    passwordResetToken: {
      type: String,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },

    passwordChangedAt: {
      type: Date,
      select: false,
    },

    // =========================================================
    // LOGIN SECURITY
    // =========================================================

    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    lockUntil: {
      type: Date,
      select: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastLoginIp: {
      type: String,
      select: false,
      default: null,
    },

    // =========================================================
    // TWO-FACTOR AUTHENTICATION
    // =========================================================

    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },

    twoFactorSecret: {
      type: String,
      select: false,
    },

    // =========================================================
    // KYC
    // =========================================================

    kycStatus: {
      type: String,
      enum: [
        "not_submitted",
        "pending",
        "verified",
        "rejected",
      ],
      default: "not_submitted",
      // index: true,
    },

    kycVerifiedAt: {
      type: Date,
      default: null,
    },

    // =========================================================
    // REFERRAL
    // =========================================================

    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // =========================================================
    // USER PREFERENCES
    // =========================================================

    preferences: {
      language: {
        type: String,
        default: "en",
      },

      currency: {
        type: String,
        enum: ["USD", "EUR", "GBP", "NGN"],
        default: "USD",
      },

      timezone: {
        type: String,
        default: "UTC",
      },

      emailNotifications: {
        type: Boolean,
        default: true,
      },

      tradingNotifications: {
        type: Boolean,
        default: true,
      },

      marketingEmails: {
        type: Boolean,
        default: false,
      },
    },

    // =========================================================
    // ACCOUNT DATES
    // =========================================================

    lastActiveAt: {
      type: Date,
      default: null,
    },

    accountClosedAt: {
      type: Date,
      default: null,
    },


    // =========================================================
// TWO-FACTOR AUTHENTICATION
// =========================================================

twoFactorEnabled: {
  type: Boolean,
  default: false,
  index: true,
},

twoFactorSecret: {
  type: String,
  select: false,
},

twoFactorSecretIV: {
  type: String,
  select: false,
},

twoFactorSecretAuthTag: {
  type: String,
  select: false,
},

twoFactorBackupCodes: {
  type: [String],
  select: false,
  default: [],
},

twoFactorEnabledAt: {
  type: Date,
  default: null,
},

twoFactorLastUsedAt: {
  type: Date,
  default: null,
},
},

  {
    timestamps: true,
    versionKey: false,
  }
);

// =============================================================
// INDEXES
// =============================================================

// userSchema.index({
//   email: 1,
// });

userSchema.index({
  role: 1,
  status: 1,
});

userSchema.index({
  kycStatus: 1,
});


// =============================================================
// HASH PASSWORD
// =============================================================

userSchema.pre("save", async function () {
  // Password has not changed
  if (!this.isModified("password")) {
    return;
  }

  // Generate salt
  const salt = await bcrypt.genSalt(12);

  // Hash password
  this.password = await bcrypt.hash(this.password, salt);

  // next();
});


// =============================================================
// UPDATE PASSWORD CHANGED DATE
// =============================================================

userSchema.pre("save", function () {
  if (!this.isModified("password") || this.isNew) return;

  this.passwordChangedAt = Date.now() - 1000;
});


// =============================================================
// COMPARE PASSWORD
// =============================================================

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(
    candidatePassword,
    this.password
  );
};


// =============================================================
// CHECK IF ACCOUNT IS LOCKED
// =============================================================

userSchema.methods.isLocked = function () {
  return Boolean(
    this.lockUntil &&
    this.lockUntil.getTime() > Date.now()
  );
};


// =============================================================
// CHECK PASSWORD CHANGE AFTER JWT WAS ISSUED
// =============================================================

userSchema.methods.changedPasswordAfter = function (jwtTimestamp) {
  if (!this.passwordChangedAt) {
    return false;
  }

  const changedTimestamp = parseInt(
    this.passwordChangedAt.getTime() / 1000,
    10
  );

  return jwtTimestamp < changedTimestamp;
};


// =============================================================
// GENERATE JWT
// =============================================================

userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      id: this._id,
      role: this.role,
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    }
  );
};


// =============================================================
// GENERATE EMAIL VERIFICATION TOKEN
// =============================================================

userSchema.methods.createEmailVerificationToken = function () {
  const rawToken = crypto.randomBytes(32).toString("hex");

  this.emailVerificationToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  this.emailVerificationExpires =
    Date.now() + 10 * 60 * 1000;

  return rawToken;
};


// =============================================================
// GENERATE PASSWORD RESET TOKEN
// =============================================================

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires =
    Date.now() + 10 * 60 * 1000;

  return resetToken;
};


// =============================================================
// REMOVE SENSITIVE DATA
// =============================================================

userSchema.methods.toJSON = function () {
  const user = this.toObject();

  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.emailVerificationToken;
  delete user.emailVerificationExpires;
  delete user.passwordChangedAt;
  delete user.failedLoginAttempts;
  delete user.lockUntil;
  delete user.lastLoginIp;
  delete user.twoFactorSecret;

  return user;
};


module.exports = mongoose.model("User", userSchema);