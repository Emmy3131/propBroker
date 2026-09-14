const getRefreshTokenCookieOptions = () => {
  const days = Number(
    process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30
  );

  return {
    httpOnly: true,

    secure:
      process.env.COOKIE_SECURE === "true",

    sameSite:
      process.env.COOKIE_SAME_SITE || "lax",

    maxAge:
      days * 24 * 60 * 60 * 1000,

    path: "/api/v1/auth",
  };
};

module.exports = {
  getRefreshTokenCookieOptions,
};