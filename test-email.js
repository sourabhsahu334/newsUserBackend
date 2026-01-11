import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: 'mail.privateemail.com',
    port: 465,
    secure: true,
    auth: {
        user: "support@neukaps.com",
        pass: "MueG_Tx-2g3aqSA"
    }
});

console.log('Testing SMTP connection...');
console.log('User:', process.env.EMAIL_USER);

transporter.verify(async (error, success) => {
    if (error) {
        console.error('SMTP Connection Error:', error);
    } else {
        console.log('Server is ready to take our messages');

        console.log('Sending test email to sourabhsahu339@gmail.com...');
        try {
            await transporter.sendMail({
                from: '"Neukaps Support" <support@neukaps.com>',
                to: "sourabhsahu339@gmail.com",
                subject: "SMTP Test Email",
                text: "Hello! This is a test email sent from your new Namecheap SMTP configuration.",
                html: "<b>Hello!</b><p>This is a test email sent from your new Namecheap SMTP configuration.</p>"
            });
            console.log('Test email sent successfully!');
        } catch (sendError) {
            console.error('Error sending test email:', sendError);
        }
    }
});
