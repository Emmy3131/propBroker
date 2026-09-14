const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ to, subject, html, text }) => {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: [to],
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Resend email error:", error);

    throw new Error(error.message || "Email could not be sent");
  }

  console.log("Email sent successfully:", data.id);

  return data;
};

// =========================================================
// VERIFICATION EMAIL
// =========================================================

const sendVerificationEmail = async ({ name, email, verificationToken }) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <title>Verify Your Email</title>
      </head>

      <body
        style="
          margin: 0;
          padding: 0;
          background: #f4f7fb;
          font-family: Arial, Helvetica, sans-serif;
        "
      >

        <div
          style="
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          "
        >

          <!-- Header -->

          <div
            style="
              background: #0f172a;
              padding: 30px;
              text-align: center;
            "
          >
            <h1
              style="
                margin: 0;
                color: #ffffff;
                font-size: 28px;
              "
            >
              EmmCore Broker
            </h1>

            <p
              style="
                margin: 8px 0 0;
                color: #94a3b8;
                font-size: 14px;
              "
            >
              Trading & Prop Firm Platform
            </p>
          </div>

          <!-- Content -->

          <div style="padding: 40px 30px;">

            <h2
              style="
                margin-top: 0;
                color: #111827;
              "
            >
              Verify your email
            </h2>

            <p
              style="
                color: #4b5563;
                line-height: 1.7;
              "
            >
              Hello ${name},
            </p>

            <p
              style="
                color: #4b5563;
                line-height: 1.7;
              "
            >
              Thank you for creating your EmmCore Broker account.
              Please verify your email address to activate your account.
            </p>

            <div style="text-align: center; margin: 35px 0;">

              <a
                href="${verificationUrl}"
                style="
                  display: inline-block;
                  padding: 14px 28px;
                  background: #2563eb;
                  color: #ffffff;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: bold;
                "
              >
                Verify My Email
              </a>

            </div>

            <p
              style="
                color: #6b7280;
                font-size: 14px;
                line-height: 1.6;
              "
            >
              This verification link will expire in
              <strong>10 minutes</strong>.
            </p>

            <p
              style="
                color: #6b7280;
                font-size: 14px;
                line-height: 1.6;
              "
            >
              If you did not create this account, you can safely ignore
              this email.
            </p>

            <hr
              style="
                border: none;
                border-top: 1px solid #e5e7eb;
                margin: 30px 0;
              "
            />

            <p
              style="
                color: #9ca3af;
                font-size: 12px;
                line-height: 1.5;
              "
            >
              If the button doesn't work, copy and paste this URL into
              your browser:
            </p>

            <p
              style="
                color: #2563eb;
                font-size: 12px;
                word-break: break-all;
              "
            >
              ${verificationUrl}
            </p>

          </div>

          <!-- Footer -->

          <div
            style="
              background: #f8fafc;
              padding: 20px;
              text-align: center;
            "
          >
            <p
              style="
                margin: 0;
                color: #94a3b8;
                font-size: 12px;
              "
            >
              © ${new Date().getFullYear()} EmmCore Broker.
              All rights reserved.
            </p>
          </div>

        </div>

      </body>
    </html>
  `;

  const text = `
Hello ${name},

Thank you for creating your EmmCore Broker account.

Verify your email using the link below:

${verificationUrl}

This link will expire in 10 minutes.

If you did not create this account, you can safely ignore this email.

EmmCore Broker
  `;

  return sendEmail({
    to: email,
    subject: "Verify your EmmCore Broker account",
    html,
    text,
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
};
