const Session = require("../models/SessionModel");


// =====================================================
// GET MY ACTIVE SESSIONS
// =====================================================

exports.getMySessions = async (req, res, next) => {
  try {
    const sessions = await Session.find({
      user: req.user._id,
      revoked: false,
      expiresAt: {
        $gt: new Date(),
      },
    })
      .select(
        "_id userAgent ipAddress createdAt lastUsedAt expiresAt"
      )
      .sort({
        lastUsedAt: -1,
        createdAt: -1,
      });

    res.status(200).json({
      status: "success",
      results: sessions.length,
      data: {
        sessions,
      },
    });
  } catch (error) {
    next(error);
  }
};


// =====================================================
// REVOKE ONE SESSION
// =====================================================

exports.revokeSession = async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await Session.findOne({
      _id: id,
      user: req.user._id,
      revoked: false,
    });

    if (!session) {
      return res.status(404).json({
        status: "fail",
        message: "Session not found.",
      });
    }

    session.revoked = true;
    session.revokedAt = new Date();

    await session.save();

    res.status(200).json({
      status: "success",
      message: "Session revoked successfully.",
    });
  } catch (error) {
    next(error);
  }
};