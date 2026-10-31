// Sending the account service's emails: Resend's HTTP API when RESEND_API_KEY is set,
// otherwise printed to the console (local runs).

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

export function resendMailer(apiKey: string, from: string): Mailer {
  return async ({ to, subject, text }) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  };
}

export const consoleMailer: Mailer = async ({ to, subject, text }) => {
  console.log(`--- mail to ${to}: ${subject}\n${text}\n---`);
};
