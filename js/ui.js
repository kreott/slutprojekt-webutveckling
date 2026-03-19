// buttons
const btnRun   = document.getElementById("btn-run");
const btnStep  = document.getElementById("btn-step");
const btnReset = document.getElementById("btn-reset");

// code editor
const editor = CodeMirror.fromTextArea(document.getElementById("code-input"), {
    lineNumbers: true,
    mode: "asm",
    theme: "custom",
    indentWithTabs: false,
    tabSize: 4,
    autoCloseBrackets: true,
});

// example code
editor.setValue(
`MOV EAX, 10
MOV EBX, 3

ADD EAX, EBX
SUB EAX, 1
MUL EAX, 2

AND EAX, 0xFF
OR  EAX, 0x100
XOR EAX, 0x100
NOT EBX

MOV ECX, 5

.loop:
    INC EAX
    DEC ECX
    CMP ECX, 0
    JNE .loop

PUSH EAX
CALL .myfunc
POP EBX

JMP .end

.myfunc:
    MOV EDX, EAX
    ADD EDX, 100
    RET

.end:
    MOV ECX, 0`
);

// speed slider, setting value here because the html default wasnt sticking
const speedSlider = document.getElementById("speed-slider");
const speedSpan   = document.getElementById("speed-display");

speedSlider.value = 0;
speedSpan.textContent = "off";

speedSlider.addEventListener("input", () => {
    speedSpan.textContent = speedSlider.value == "0"
        ? "off"
        : (speedSlider.value / 1000).toFixed(1) + "s";
});

let isRunning = false;

function reset() {
    ["EAX", "EBX", "ECX", "EDX", "EBP", "ESI", "EDI", "EIP"].forEach(reg => {
        cpu.regs[reg] = 0;
    });
    cpu.regs.ESP = 1024 * 1024; // 1 MB

    cpu.flags.ZERO     = false;
    cpu.flags.CARRY    = false;
    cpu.flags.SIGN     = false;
    cpu.flags.OVERFLOW = false;

    lines = [];
    updateUIRegisters();
    updateUIFlags();

    document.getElementById("log-output").innerHTML = "";
}

btnRun.addEventListener("click", () => {
    if (isRunning) {
        reset();
        return;
    }

    reset();

    const errors = validate(editor.getValue());
    if (errors.length > 0) {
        errors.forEach(e => log(e, true));
        return;
    }

    isRunning = true;
    btnRun.disabled = true;

    if (cpu.regs.EIP === 0) loadProgram(editor.getValue());

    if (speedSlider.value == "0") {
        while (cpu.regs.EIP < lines.length) step();
        btnRun.disabled = false;
        isRunning = false;
    } else {
        run(speedSlider.value);
    }
});

btnStep.addEventListener("click", () => {
    if (isRunning) return;
    if (cpu.regs.EIP === 0) {
        const errors = validate(editor.getValue());
        if (errors.length > 0) {
            errors.forEach(e => log(e, true));
            return;
        }
        loadProgram(editor.getValue());
    }
    step();
});

btnReset.addEventListener("click", reset);

const MAIN_REGISTER_NAMES = ["EAX", "EIP", "EBX", "ESP", "ECX", "EBP", "EDX", "ESI"];

function updateUIRegisters() {
    MAIN_REGISTER_NAMES.forEach(reg => {
        const el = document.getElementById(`reg-${reg}`);
        if (el) el.querySelector(".reg-value").textContent = cpu.regs[reg];
    });

    const popup = document.getElementById("reg-popup");
    if (popup?.style.display !== "none") renderRegisterPopup();
}

function updateUIFlags() {
    Object.keys(cpu.flags).forEach(flag => {
        const el = document.getElementById(`flag-${flag}`);
        if (el) el.querySelector(".flag-value").textContent = cpu.flags[flag];
    });
}

function log(message, isError = false) {
    const entry = document.createElement("div");
    entry.textContent = message;
    if (isError) entry.classList.add("error");
    const logOutput = document.getElementById("log-output");
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight; // automatically scrolls to the bottom

}

const POPUP_GROUPS = [
    { label: "A",   regs: ["EAX", "AX", "AH", "AL"] },
    { label: "B",   regs: ["EBX", "BX", "BH", "BL"] },
    { label: "C",   regs: ["ECX", "CX", "CH", "CL"] },
    { label: "D",   regs: ["EDX", "DX", "DH", "DL"] },
    { label: "Ptr", regs: ["ESP", "EBP", "ESI", "EDI", "EIP"] },
];

function renderRegisterPopup() {
    const container = document.getElementById("reg-popup-body");
    if (!container) return;
    container.innerHTML = "";

    POPUP_GROUPS.forEach(group => {
        const section = document.createElement("div");
        section.className = "reg-popup-group";

        for (let i = 0; i < group.regs.length; i += 2) {
            const row = document.createElement("div");
            row.className = "reg-popup-row";

            const a = group.regs[i];
            const b = group.regs[i + 1];

            row.innerHTML = b
                ? `<span class="reg-name">${a}:</span><span class="reg-val">${cpu.regs[a]}</span><span class="reg-name">${b}:</span><span class="reg-val">${cpu.regs[b]}</span>`
                : `<span class="reg-name">${a}:</span><span class="reg-val">${cpu.regs[a]}</span>`;

            section.appendChild(row);
        }

        container.appendChild(section);
    });
}

function openRegisterPopup() {
    renderRegisterPopup();
    document.getElementById("reg-popup").style.display = "block";
}

function closeRegisterPopup() {
    document.getElementById("reg-popup").style.display = "none";
}

function makeDraggable(popup, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("mousedown", (e) => {
        dragging = true;
        offsetX = e.clientX - popup.getBoundingClientRect().left;
        offsetY = e.clientY - popup.getBoundingClientRect().top;
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        popup.style.left = (e.clientX - offsetX) + "px";
        popup.style.top  = (e.clientY - offsetY) + "px";
    });

    document.addEventListener("mouseup", () => dragging = false);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-show-regs")?.addEventListener("click", openRegisterPopup);
    document.getElementById("btn-close-reg-popup")?.addEventListener("click", closeRegisterPopup);

    makeDraggable(
        document.querySelector(".reg-popup-inner"),
        document.querySelector(".reg-popup-titlebar")
    );
});