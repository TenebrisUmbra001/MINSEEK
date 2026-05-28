// Backend/emailService.js
const nodemailer = require('nodemailer');

const ZIMBRA_CONFIG = {
    host: 'mail.das.pdr', 
    port: 465,            
    secure: true,         
    auth: {
        user: 'no-reply@das.pdr', // Tu correo real
        pass: 'tu_contraseña_aqui' 
    },
    // ✅ SOLUCIÓN AL ERROR DE CERTIFICADO:
    // Esto le dice a Node.js que acepte el certificado de Zimbra aunque sea autofirmado
    tls: {
        rejectUnauthorized: false
    }
};

const transporter = nodemailer.createTransport(ZIMBRA_CONFIG);

async function enviarCodigoVerificacion(correoDestino, codigo) {
    try {
        const mailOptions = {
            from: `"Sistema IACCR" <${ZIMBRA_CONFIG.auth.user}>`,
            to: correoDestino,
            subject: 'Código de Verificación - CHATBOT con IACCR',
            text: `Gracias por usar nuestro servicio de CHATBOT con IACCR. Tu código de verificación de la cuenta es: ${codigo}. Expira en 10 minutos.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px; margin: auto; background-color: #f9f9f9;">
                    <div style="background-color: #2ecc71; padding: 10px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="color: white; margin: 0;">CHATBOT con IACCR</h2>
                    </div>
                    <div style="padding: 20px; background-color: white; border-radius: 0 0 8px 8px;">
                        <p style="font-size: 16px; color: #333;">Hola,</p>
                        <p style="font-size: 16px; color: #333;">Para completar tu registro, utiliza el siguiente código:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #2ecc71; background: #e8f8f0; padding: 15px 30px; border-radius: 8px; letter-spacing: 8px; border: 2px dashed #2ecc71;">${codigo}</span>
                        </div>
                        <p style="color: #888; font-size: 14px; text-align: center;">⏳ Este código expira en <strong>10 minutos</strong>.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px; text-align: center;">Si no solicitaste este registro, ignora este correo.</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('📧 Correo enviado exitosamente: %s', info.messageId);
        return { exitoso: true };
    } catch (error) {
        console.error('❌ Error enviando correo por Zimbra:', error.message);
        return { exitoso: false, error: error.message };
    }
}

module.exports = { enviarCodigoVerificacion };