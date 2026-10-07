const dotenv = require("dotenv");
dotenv.config({
  path: "./config.env",
});
console.log(
  "PAYSTACK_SECRET_KEY configured:",
  Boolean(process.env.PAYSTACK_SECRET_KEY)
);
const app = require("./index.js");
const PORT = process.env.PORT || 4000;
const connectDB = require("./src/config/DB.js");

connectDB();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
