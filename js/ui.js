// buttons
const btnRun = document.getElementById("btn-run");
const btnStep = document.getElementById("btn-step");
const btnReset = document.getElementById("btn-reset");
// text editor
const editor = CodeMirror.fromTextArea(document.getElementById("code-input"), {
    lineNumbers: true,
    mode: "gas",
    theme: "default",
    indentWithTabs: false,
    tabSize: 4,
    autoCloseBrackets: true,
});

// initialize editor with a placeholder
editor.setValue(`
    MOV AX, 0
    MOV BX, 1
    MOV CX, 7
    loop:
        ADD AX, BX
        ADD BX, AX
        SUB CX, 1
        CMP CX, 0
        JNE loop
`);

// speed settings
const speedSlider = document.getElementById("speed-slider");
const speedSpan = document.getElementById("speed-display");

// handle slider label
speedSpan.textContent = "off";
speedSlider.addEventListener("input", () => {
    if (speedSlider.value == "0") {
        speedSpan.textContent = "off";
    } else {
        speedSpan.textContent = (speedSlider.value / 1000).toFixed(1) + "s"
    }
});

// handle buttons

// run full code button
let isRunning = false;
btnRun.addEventListener("click", () => {
    if (isRunning) return;
    isRunning = true;
    btnRun.disabled = true;
    if (speedSlider.value == "0") {
        if (cpu.PC === 0) {
            loadProgram(editor.getValue());
        }
        while (cpu.PC < lines.length) {
            step();
        }
        btnRun.disabled = false;
        isRunning = false;
    } else {
        if (cpu.PC === 0) {
            loadProgram(editor.getValue());
        }
        run(speedSlider.value);
    }
});

// execute next line
btnStep.addEventListener("click", () => {
    if (cpu.PC === 0) {
        loadProgram(editor.getValue());
    }
    step();
});

// set everything to 0 / false
btnReset.addEventListener("click", () => {
    cpu.PC = 0;
    Object.keys(cpu.registers).forEach(reg => {
    cpu.registers[reg] = 0;
    });
    cpu.flags.carry = false;
    cpu.flags.zero = false;
    lines = [];
    updateRegisters();
    updateFlags();
    updatePC();

    // reset the log and delete all child elements
    document.querySelector("#log-output").innerHTML = "";
});

// updates the registers value (the labels)
function updateRegisters() {
    Object.keys(cpu.registers).forEach(reg => {
        let label = document.getElementById(`reg-${reg}`);
        label.querySelector(".reg-value").textContent = cpu.registers[reg]; 
    });
}

// updates the flags value (the labels)
function updateFlags() {
    Object.keys(cpu.flags).forEach(flag => {
        let label = document.getElementById(`flag-${flag}`);
        label.querySelector(".flag-value").textContent = cpu.flags[flag];
    });
}

// update program counter 
function updatePC() {
    let label = document.getElementById("pc-display")
    label.querySelector(".pc-value").textContent = cpu.PC;
}

// output 
function log(message, isError = false) {
    const entry = document.createElement("div");
    entry.textContent = message;
    if (isError) {
        entry.classList.add("error");
    }
    const logOutput = document.getElementById("log-output");
    logOutput.appendChild(entry);
}