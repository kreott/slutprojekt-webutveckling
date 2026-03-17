// cpu state
const cpu = {
    registers: {
        AX: 0,
        BX: 0,
        CX: 0,
        DX: 0,

        EAX: 0,
        EBX: 0,
        ECX: 0,
        EDX: 0,
    },
    PC: 0,
    flags: {
        zero: false, 
        carry: false,
    }
}
// parse line
function parseLine(line) {
    line = line.trim().toUpperCase();
    // remove ; comments
    line = line.split(";")[0].trim(); 
    if (line === "") return null;
    const parts = line.split(" "); // parts of the line, operation, destination etc
    const op = parts[0]; // operation
    const args = parts.slice(1).join(" ").split(", ") // splits the arguments of the line into an array
    return { raw: line, op: op, args: args };
}
// checks if value is a register or a literal
function resolveVal(val) {
    return cpu.registers[val] !== undefined 
    ? cpu.registers[val]
    : Number(val)
}
// execute the operation
// also where all the operations are defined
function execute(inst) {
    switch (inst.op) {
        // move src into dest
        case "MOV": {
            const dest = inst.args[0]
            const src = resolveVal(inst.args[1])
            cpu.registers[dest] = src;
            break;
        }
        // add src to dest
        case "ADD": {
            const dest = inst.args[0];
            const src = resolveVal(inst.args[1]);
            cpu.registers[dest] += src;
            break;
        }
        // subtract src from dest
        case "SUB": {
            const dest = inst.args[0];
            const src = resolveVal(inst.args[1]);
            cpu.registers[dest] -= src;
            break;
        }
        // multiply dest by src
        case "MUL": {
            const dest = inst.args[0];
            const src = resolveVal(inst.args[1]);
            cpu.registers[dest] *= src;
            break;
        }
        // compare dest and src, set zero/carry flags
        case "CMP": {
            const dest = resolveVal(inst.args[0]);
            const src = resolveVal(inst.args[1]);
            if (dest === src) { 
                cpu.flags.zero = true;
                cpu.flags.carry = false;
            }
            else if (dest < src) {
                cpu.flags.zero = false;
                cpu.flags.carry = true; // dest < src, carry set
            } else {
                cpu.flags.zero = false;
                cpu.flags.carry = false; // dest > src, both clear
            }
            break;
        }
        // unconditional jump to label
        case "JMP": {
            cpu.PC = labels[inst.args[0]];
            break;
        }
        // jump if equal
        case "JE": {
            if (cpu.flags.zero === true) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // jump if not equal
        case "JNE": {
            if (cpu.flags.zero === false) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // jump if greater than
        case "JG": {
            if (cpu.flags.zero === false && cpu.flags.carry === false) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // jump if greater or equal
        case "JGE": {
            if (cpu.flags.zero === true || cpu.flags.carry === false) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // jump if less than
        case "JL": {
            if (cpu.flags.carry === true) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // jump if less or equal
        case "JLE": {
            if (cpu.flags.zero === true || cpu.flags.carry === true) {
                cpu.PC = labels[inst.args[0]];
            }
            break;
        }
        // default case, error or label
        default: {
            if (!inst.raw.endsWith(":")) {
                log("Syntax error: " + "'" + inst.op + "'", true);
            }
            break; 
        }
    }
}
let lines = [];
let labels = {};
// load and parse the program, build label map
function loadProgram(code) {
    lines = code.split("\n").map(parseLine).filter(line => line !== null);
    // check assembly labels
    let offset = 0;
    lines.forEach((line, index) => {
        if (line.raw.endsWith(":")) {
            labels[line.raw.slice(0, -1)] = index - offset; // map label to line index
            offset++;
        }
    });
    lines = lines.filter(line => !line.raw.endsWith(":")); // remove label lines
}
// execute one instruction and advance PC
function step() {
    if (cpu.PC >= lines.length) {
        return;
    }
    log(lines[cpu.PC].raw);
    // execute current instruction
    const prevPC = cpu.PC;
    execute(lines[cpu.PC]);
    if (cpu.PC === prevPC) cpu.PC++; // advance PC if no jump occurred
    // update UI
    updateRegisters();
    updateFlags();
    updatePC();
}
// run with a delay (or none)
function run(delay) {
    const timer = setInterval(() => {
        step();
        if (cpu.PC >= lines.length) {
            clearInterval(timer); // stop when program ends
            isRunning = false;
            btnRun.disabled = false;
        }
    }, delay);
}