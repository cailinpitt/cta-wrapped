const nodemailer = require('nodemailer');
const { email } = require('./keys.js');

const sendMail = async ({ subject, text, attachments = [] }) => {
    if (!email) {
        console.log('No email configuration found, skipping notification');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: email.service,
        auth: { user: email.user, pass: email.password }
    });

    try {
        await transporter.sendMail({
            from: email.user,
            to: email.to || email.user,
            subject,
            text,
            attachments
        });
        console.log('Email sent');
    } catch (err) {
        console.error('Failed to send email:', err.message);
    }
};

module.exports = { sendMail };
