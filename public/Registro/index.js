/* ========================================
   Toggle mostrar/ocultar contraseña
======================================== */
var botones = document.querySelectorAll('.toggle-password');
for (var i = 0; i < botones.length; i++) {
    botones[i].addEventListener('click', function () {
        var targetId = this.getAttribute('data-target');
        var input = document.getElementById(targetId);
        var eyeOpen = this.querySelector('.eye-open');
        var eyeClosed = this.querySelector('.eye-closed');

        if (input.type === 'password') {
            input.type = 'text';
            eyeOpen.style.display = 'none';
            eyeClosed.style.display = 'block';
            this.setAttribute('aria-label', 'Ocultar contraseña');
        } else {
            input.type = 'password';
            eyeOpen.style.display = 'block';
            eyeClosed.style.display = 'none';
            this.setAttribute('aria-label', 'Mostrar contraseña');
        }
    });
}

/* ========================================
   Lógica del Modal, Timer y Intentos
======================================== */
var timerModal = null;
var timerInterval = null;
var intentosRestantes = 5;
var tiempoRestanteSegundos = 600; // 10 minutos en segundos

function iniciarTimerModal() {
    // Limpiar timers anteriores si existen
    if (timerModal) clearTimeout(timerModal);
    if (timerInterval) clearInterval(timerInterval);

    tiempoRestanteSegundos = 600; // Reiniciar a 10 minutos

    // Actualizar la vista cada segundo
    timerInterval = setInterval(function() {
        tiempoRestanteSegundos--;
        
        var minutos = Math.floor(tiempoRestanteSegundos / 60);
        var segundos = tiempoRestanteSegundos % 60;
        
        document.getElementById('timerModalTexto').textContent = 
            'Tiempo restante: ' + minutos + ':' + (segundos < 10 ? '0' : '') + segundos;

        if (tiempoRestanteSegundos <= 0) {
            CerrarModal(true); // True indica que fue por timeout
        }
    }, 1000);
}

function MostrarModalCodigo() {
    var modal = document.getElementById('modalCodigo');
    var inputCodigo = document.getElementById('Codigo');
    var btnValidar = document.getElementById('btnValidarCodigo');
    var intentosTexto = document.getElementById('intentosModal');
    
    // Resetear estado del modal
    inputCodigo.value = ''; 
    inputCodigo.disabled = false;
    btnValidar.disabled = false;
    
    intentosRestantes = 5;
    intentosTexto.textContent = 'Intentos restantes: ' + intentosRestantes;
    intentosTexto.style.color = '#2ecc71'; // Color verde inicial
    
    modal.classList.add('active');
    iniciarTimerModal();
}

function CerrarModal(porTimeout) {
    var modal = document.getElementById('modalCodigo');
    modal.classList.remove('active');
    
    // Detener y destruir los timers
    if (timerModal) { clearTimeout(timerModal); timerModal = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    if (porTimeout) {
        alert("La ventana de validación se cerró por inactividad (10 minutos). Debe intentar registrarse nuevamente.");
    }
}

/* ========================================
   PASO 1: Validar campos, correo y contraseñas
======================================== */
function ValidarCorreo() {
    var usuario = document.getElementById("Usuario").value.trim();
    var correo = document.getElementById("Correo").value.trim();
    var contraseña = document.getElementById("Contraseña").value;
    var confirmar = document.getElementById("ConfirmarContraseña").value;
    var dominioCorrecto = "mail.das.pdr";

    if (usuario === "" || correo === "" || contraseña === "" || confirmar === "") {
        alert("Por favor, complete todos los campos.");
        return false;
    }

    var partes = correo.split("@");
    if (partes.length !== 2) {
        alert("El formato del correo es incorrecto. Debe contener exactamente un '@'.");
        return false;
    }

    var usuarioCorreo = partes[0];
    var dominioIngresado = partes[1];

    if (dominioIngresado !== dominioCorrecto) {
        alert("El correo debe terminar en @" + dominioCorrecto);
        return false;
    }

    var regexUsuario = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
    if (!regexUsuario.test(usuarioCorreo)) {
        alert("La parte antes del '@' es inválida. Solo letras, números, puntos, guiones y guiones bajos.");
        return false;
    }

    if (contraseña !== confirmar) {
        alert("Las contraseñas no coinciden. Por favor, verifique.");
        return false;
    }

    // Todo correcto -> Abrir modal
    MostrarModalCodigo();
    return true;
}

/* ========================================
   PASO 2: Validar código de seguridad (Con intentos)
======================================== */
function ValidarCodigo() {
    var codigo = document.getElementById("Codigo").value.trim();
    var intentosTexto = document.getElementById('intentosModal');
    var inputCodigo = document.getElementById("Codigo");
    var btnValidar = document.getElementById('btnValidarCodigo');

    if (codigo === "") {
        alert("Por favor, ingrese el código de seguridad.");
        return;
    }

    if (codigo === "123456") {
        CerrarModal(false); // False indica que fue manual y exitoso
        alert("Registro exitoso. ¡Bienvenido!");
        // window.location.href = "../InicioSesion/index.html";
    } else {
        intentosRestantes--;
        
        if (intentosRestantes > 0) {
            intentosTexto.textContent = 'Código incorrecto. Intentos restantes: ' + intentosRestantes;
            intentosTexto.style.color = '#e74c3c'; // Rojo de error
            inputCodigo.value = '';
            inputCodigo.focus();
        } else {
            intentosTexto.textContent = 'Sin intentos. Bloqueado.';
            intentosTexto.style.color = '#e74c3c';
            inputCodigo.disabled = true;
            btnValidar.disabled = true;
            
            // Esperar 3 segundos para que lea el mensaje y luego cerrar
            setTimeout(function() {
                CerrarModal(true);
                // Rehabilitar botones por si quiere volver a dar "Registrar Cuenta" desde 0
                inputCodigo.disabled = false;
                btnValidar.disabled = false;
            }, 3000);
        }
    }
}