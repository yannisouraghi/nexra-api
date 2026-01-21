// Email service using Resend API

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(apiKey: string, options: SendEmailOptions): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Nexra <noreply@nexra-ai.app>',
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

// Generate 6-digit verification code
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create styled verification email HTML
export function createVerificationEmailHtml(code: string, userName?: string): string {
  const greeting = userName ? `Hey ${userName}` : 'Hey';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Nexra account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <img src="https://www.nexra-ai.app/nexra-logo.png" alt="Nexra" width="180" style="display: block; max-width: 180px; height: auto;" />
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(180deg, rgba(20, 20, 30, 0.98) 0%, rgba(10, 10, 15, 0.98) 100%); border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden;">

                <!-- Gradient top border -->
                <tr>
                  <td style="height: 3px; background: linear-gradient(90deg, #00d4ff 0%, #0066ff 100%);"></td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px 32px;">

                    <!-- Greeting -->
                    <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700; color: white;">
                      ${greeting},
                    </h1>
                    <p style="margin: 0 0 32px 0; font-size: 16px; color: rgba(255, 255, 255, 0.7); line-height: 1.6;">
                      Welcome to Nexra! Use the code below to verify your email address.
                    </p>

                    <!-- Code Box -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center" style="padding: 24px; background: rgba(0, 212, 255, 0.08); border: 1px solid rgba(0, 212, 255, 0.2); border-radius: 12px;">
                          <p style="margin: 0 0 12px 0; font-size: 13px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 1px;">
                            Verification Code
                          </p>
                          <p style="margin: 0; font-size: 40px; font-weight: 700; color: #00d4ff; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                            ${code}
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Expiry notice -->
                    <p style="margin: 24px 0 0 0; font-size: 14px; color: rgba(255, 255, 255, 0.5); text-align: center;">
                      This code expires in <strong style="color: rgba(255, 255, 255, 0.8);">15 minutes</strong>
                    </p>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 24px 32px; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                    <p style="margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.4); text-align: center;">
                      If you didn't create a Nexra account, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Bottom text -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="margin: 0; font-size: 12px; color: rgba(255, 255, 255, 0.3);">
                Nexra - AI-Powered League of Legends Coaching
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: rgba(255, 255, 255, 0.3);">
                <a href="https://nexra-ai.app" style="color: #00d4ff; text-decoration: none;">nexra-ai.app</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
