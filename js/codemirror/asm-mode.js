/* you can ignore this file, i found someone online who had made a custom intel assembly mode for codemirror, gives syntax highlighting */
CodeMirror.defineMode("asm", function() {
    const instructions = /^(MOV|ADD|SUB|MUL|DIV|INC|DEC|NEG|AND|OR|XOR|NOT|SHL|SHR|CMP|TEST|JMP|JE|JNE|JG|JL|JGE|JLE|JZ|JNZ|JC|JNC|JS|JNS|CALL|RET|PUSH|POP|NOP|HLT|INT|LEA|XCHG|CBW|CWD|PRINT|%DEFINE|DD|DB|DW|DQ|DT)\b/i;
    const registers = /^(RAX|RBX|RCX|RDX|RSI|RDI|RSP|RBP|EAX|EBX|ECX|EDX|ESI|EDI|ESP|EBP|AX|BX|CX|DX|SI|DI|SP|BP|AH|AL|BH|BL|CH|CL|DH|DL|CS|DS|ES|FS|GS|SS)\b/i;
    const label = /^[A-Z_][A-Z0-9_]*:/i;
    const hex = /^0x[0-9a-fA-F]+/i;
    const number = /^-?[0-9]+\b/;
    const comment = /^;.*/;

    return {
        token: function(stream) {
            // skip whitespace
            if (stream.eatSpace()) return null;

            // comments
            if (stream.match(comment)) return "comment";

            // label definitions
            if (stream.match(label)) return "def";

            // instructions
            if (stream.match(instructions)) return "keyword";

            // registers
            if (stream.match(registers)) return "variable";

            // hexadecimal
            if (stream.match(hex)) return "hex";

            // numbers
            if (stream.match(number)) return "number";

            // anything else, advance one char
            stream.next();
            return null;
        }
    };
});