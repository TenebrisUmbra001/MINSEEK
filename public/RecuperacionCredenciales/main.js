/**
 * Recuperación de Contraseña — Lógica del frontend compatible con FF43+
 */

var API_BASE = '';  // Relativo al mismo origen

// Estado global del flujo
var idUsuarioRecuperacion = null;
var correoRecuperacion = null;
var resendInterval = null;

// ── Referencias DOM ──
var emailInput       = document.getElementById('emailInput');
var emailMsg         = document.getElementById('emailMsg');
var btnSendCode      = document.getElementById('btnSendCode');

var codeInput        = document.getElementById('codeInput');
var newPassInput     = document.getElementById('newPassInput');
var confirmPassInput = document.getElementById('confirmPassInput');
var step2Msg         = document.getElementById('step2Msg');
var btnChangePass    = document.getElementById('btnChangePass');
var btnBack          = document.getElementById('btnBack');
var btnResend        = document.getElementById('btnResend');
var resendTimer      = document.getElementById('resendTimer');

var strengthFill     = document.getElementById('strengthFill');
var strengthText     = document.getElementById('strengthText');

// ── Utilidades ──

function mostrarMsg(el, texto, tipo) {
    el.textContent = texto;
    el.className = 'inline-msg ' + tipo;  // 'error' o 'success'
}

function limpiarMsg(el) {
    el.textContent = '';
    el.className = 'inline-msg';
}

function setLoading(btn, loading) {
    var txt = btn.querySelector('.btn-text');
    var spn = btn.querySelector('.btn-spinner');
    if (loading) {
        btn.disabled = true;
        if (txt) txt.style.visibility = 'hidden';
        if (spn) spn.classList.remove('hidden');
    } else {
        btn.disabled = false;
        if (txt) txt.style.visibility = 'visible';
        if (spn) spn.classList.add('hidden');
    }
}

function validarEmailZimbra(email) {
    var regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email)) return { valid: false, error: 'Formato de correo inválido' };
    if (!email.endsWith('@mail.das.pdr')) return { valid: false, error: 'El correo debe ser Zimbra (@mail.das.pdr)' };
    if (!/^[a-zA-Z0-9._-]+$/.test(email.split('@')[0])) return { valid: false, error: 'Caracteres inválidos en el correo' };
    return { valid: true };
}

function evaluarFortaleza(password) {
    if (!password) return { nivel: '', texto: '' };
    var score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { nivel: 'weak', texto: 'Débil' };
    if (score === 2) return { nivel: 'fair', texto: 'Regular' };
    if (score === 3) return { nivel: 'good', texto: 'Buena' };
    return { nivel: 'strong', texto: 'Fuerte' };
}

function iniciarCountdown(segundos) {
    var restante = segundos;
    btnResend.disabled = true;
    resendTimer.textContent = '(' + restante + 's)'; // ✅ FIX template literal

    if (resendInterval) clearInterval(resendInterval);

    resendInterval = setInterval(function() { // ✅ FIX arrow function
        restante--;
        if (restante <= 0) {
            clearInterval(resendInterval);
            resendInterval = null;
            btnResend.disabled = false;
            resendTimer.textContent = '';
        } else {
            resendTimer.textContent = '(' + restante + 's)';
        }
    }, 1000);
}

// ── Navegación entre pasos ──

function goToStep(num) {
    // Ocultar todos los paneles
    var panels = document.querySelectorAll('.step-panel');
    for (var p = 0; p < panels.length; p++) { // ✅ FIX NodeList.forEach
        panels[p].classList.add('hidden');
    }

    // Mostrar panel correspondiente
    var panel = document.getElementById('panel' + num);
    if (panel) {
        panel.classList.remove('hidden');
        // Forzar re-animación
        panel.style.animation = 'none';
        panel.offsetHeight;  // reflow
        panel.style.animation = '';
    }

    // Actualizar indicadores
    for (var i = 1; i <= 3; i++) {
        var ind = document.getElementById('stepInd' + i);
        ind.classList.remove('active', 'completed');
        if (i < num) ind.classList.add('completed');
        else if (i === num) ind.classList.add('active');
    }

    // ✅ FIX classList.toggle con booleano no soportado en FF43
    var line1 = document.getElementById('line1');
    var line2 = document.getElementById('line2');
    if (num >= 2) line1.classList.add('active'); else line1.classList.remove('active');
    if (num >= 3) line2.classList.add('active'); else line2.classList.remove('active');

    // Cambiar ícono de step completado (checkmark)
    for (var j = 1; j <= 3; j++) {
        var ind2 = document.getElementById('stepInd' + j);
        var numEl = ind2.querySelector('.step-num');
        if (j < num) {
            numEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else {
            numEl.textContent = j;
        }
    }
}

// ── Toggle password ──
var togglePassBtns = document.querySelectorAll('.toggle-pass');
for (var t = 0; t < togglePassBtns.length; t++) { // ✅ FIX NodeList.forEach
    togglePassBtns[t].addEventListener('click', function () {
        var targetId = this.getAttribute('data-target');
        var input = document.getElementById(targetId);
        var eyeOpen = this.querySelector('.ico-eye');
        var eyeOff = this.querySelector('.ico-eye-off');

        if (input.type === 'password') {
            input.type = 'text';
            eyeOpen.classList.add('hidden');
            eyeOff.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeOpen.classList.remove('hidden');
            eyeOff.classList.add('hidden');
        }
    });
}

// ── Fortaleza de contraseña en tiempo real ──
newPassInput.addEventListener('input', function () {
    var f = evaluarFortaleza(this.value);
    strengthFill.className = 'strength-fill ' + f.nivel;
    strengthText.className = 'strength-text ' + f.nivel;
    strengthText.textContent = f.texto;
});

// ── Solo números en el código ──
codeInput.addEventListener('input', function () {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
});

// ── Enter en los inputs ──
emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') enviarCodigo(); });
codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') cambiarPassword(); });

// ── PASO 1: Enviar código al correo ──

function enviarCodigo() {
    limpiarMsg(emailMsg);
    emailInput.classList.remove('input-error', 'input-success');

    var correo = emailInput.value.trim();
    var validacion = validarEmailZimbra(correo);

    if (!validacion.valid) {
        mostrarMsg(emailMsg, validacion.error, 'error');
        emailInput.classList.add('input-error');
        emailInput.focus();
        return;
    }

    setLoading(btnSendCode, true);

    // ✅ FIX async/await y .finally
    function restaurarBtn1() { setLoading(btnSendCode, false); }

    fetch(API_BASE + '/api/recuperar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: correo })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.exitoso) {
            correoRecuperacion = correo;
            idUsuarioRecuperacion = data.idUsuario || null;
            mostrarMsg(emailMsg, 'Código enviado a tu correo', 'success');
            emailInput.classList.add('input-success');

            setTimeout(function() {
                goToStep(2);
                limpiarMsg(emailMsg);
                iniciarCountdown(60);
                codeInput.focus();
            }, 800);
            
            restaurarBtn1();
        } else {
            mostrarMsg(emailMsg, data.error || 'No se pudo enviar el código', 'error');
            emailInput.classList.add('input-error');
            restaurarBtn1();
        }
    })
    .catch(function(err) {
        mostrarMsg(emailMsg, 'Error de conexión. Intenta de nuevo.', 'error');
        restaurarBtn1();
    });
}

btnSendCode.addEventListener('click', enviarCodigo);

// ── Reenviar código ──

function reenviarCodigo() {
    if (!correoRecuperacion) return;
    btnResend.disabled = true;
    limpiarMsg(step2Msg);

    fetch(API_BASE + '/api/recuperar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: correoRecuperacion })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.exitoso) {
            idUsuarioRecuperacion = data.idUsuario || idUsuarioRecuperacion;
            mostrarMsg(step2Msg, 'Nuevo código enviado', 'success');
            iniciarCountdown(60);
        } else {
            mostrarMsg(step2Msg, data.error || 'No se pudo reenviar', 'error');
            btnResend.disabled = false;
        }
    })
    .catch(function(err) {
        mostrarMsg(step2Msg, 'Error de conexión', 'error');
        btnResend.disabled = false;
    });
}

btnResend.addEventListener('click', reenviarCodigo);

// ── Botón atrás ──
btnBack.addEventListener('click', function () { goToStep(1); limpiarMsg(step2Msg); });

// ── PASO 2: Cambiar contraseña ──

function cambiarPassword() {
    limpiarMsg(step2Msg);

    var codigo = codeInput.value.trim();
    var nuevaPass = newPassInput.value;
    var confirmPass = confirmPassInput.value;

    if (!codigo || codigo.length !== 6) {
        mostrarMsg(step2Msg, 'Ingresa el código de 6 dígitos', 'error');
        codeInput.classList.add('input-error');
        codeInput.focus();
        return;
    }
    codeInput.classList.remove('input-error');

    if (!nuevaPass || nuevaPass.length < 6) {
        mostrarMsg(step2Msg, 'La contraseña debe tener al menos 6 caracteres', 'error');
        newPassInput.classList.add('input-error');
        newPassInput.focus();
        return;
    }
    newPassInput.classList.remove('input-error');

    if (nuevaPass !== confirmPass) {
        mostrarMsg(step2Msg, 'Las contraseñas no coinciden', 'error');
        confirmPassInput.classList.add('input-error');
        confirmPassInput.focus();
        return;
    }
    confirmPassInput.classList.remove('input-error');

    if (!idUsuarioRecuperacion) {
        mostrarMsg(step2Msg, 'Sesión de recuperación inválida. Vuelve a ingresar tu correo.', 'error');
        return;
    }

    setLoading(btnChangePass, true);

    // ✅ FIX async/await y .finally
    function restaurarBtn2() { setLoading(btnChangePass, false); }

    fetch(API_BASE + '/api/restablecer-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            idUsuario: idUsuarioRecuperacion,
            codigo: codigo,
            nuevaContrasena: nuevaPass
        })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
        if (data.exitoso) {
            goToStep(3);
            idUsuarioRecuperacion = null;
            correoRecuperacion = null;
            restaurarBtn2();
        } else {
            mostrarMsg(step2Msg, data.error || 'No se pudo cambiar la contraseña', 'error');
            restaurarBtn2();
        }
    })
    .catch(function(err) {
        mostrarMsg(step2Msg, 'Error de conexión. Intenta de nuevo.', 'error');
        restaurarBtn2();
    });
}

btnChangePass.addEventListener('click', cambiarPassword);