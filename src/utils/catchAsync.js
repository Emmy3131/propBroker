
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error("ASYNC CONTROLLER ERROR:", error.stack || error);

      if (typeof next === "function") {
        return next(error);
      }

      console.error("Express next callback is unavailable.");
    });
  };
};

module.exports = catchAsync;
