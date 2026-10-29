// Exact edits for the published 1.3.0 distribution. Never patch unknown versions.
const changes = [];
const add = (file, oldText, newText, count = 1) => changes.push({ file, oldText, newText, count });
const session = 'pi-coding-agent/dist/core/agent-session.js';
const runner = 'pi-coding-agent/dist/core/extensions/runner.js';
const types = 'pi-coding-agent/dist/core/extensions/types.d.ts';
const loop = 'pi-agent-core/dist/agent-loop.js';
add(session, '    _agentRunAbortRequested = false;', '    _agentRunAbortRequested = false;\n    _pauseRequested = false;');
add(session, '    _installAgentBoundaryHooks() {', `    _installAgentBoundaryHooks() {
        this.agent.shouldPause = () => this._pauseRequested;`);
add(session, '            if (previousDecision?.action === "end")', '            if (this._pauseRequested) return { action: "end" };\n            if (previousDecision?.action === "end")');
add(session, '        this._agentRunAbortRequested = false;', '        this._agentRunAbortRequested = false;\n        this._pauseRequested = false;');
// Keep abort's semantics distinct: do NOT abort the model or tool signal on pause.
add(session, 'if (this._agentRunAbortRequested)', 'if (this._agentRunAbortRequested || this._pauseRequested)', 7);
add(session, 'while (!this._agentRunAbortRequested)', 'while (!this._agentRunAbortRequested && !this._pauseRequested)');
add(session, 'if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary()))', 'if (this._agentRunAbortRequested || this._pauseRequested || !(await this._runBeforeSettleBoundary()))');
add(session, 'return !this._agentRunAbortRequested;', 'return !this._agentRunAbortRequested && !this._pauseRequested;', 2);
add(session, 'return !this._agentRunAbortRequested && this.agent.hasQueuedMessages();', 'return !this._agentRunAbortRequested && !this._pauseRequested && this.agent.hasQueuedMessages();');
add(session, 'if (this._abortDuringBeforeSettle)', 'if (this._abortDuringBeforeSettle || this._pauseRequested)');
add(session, 'await this._extensionRunner.emit({ type: "agent_settled", aborted });\n            this._emit({ type: "agent_settled", aborted });', 'await this._extensionRunner.emit({ type: "agent_settled", aborted, paused: this._pauseRequested });\n            this._emit({ type: "agent_settled", aborted, paused: this._pauseRequested });');
add(session, '    async prompt(text, options) {', `    async prompt(text, options) {
        // Extensions cannot restart a paused run, including from agent_settled.
        // Keep their work queued; the next explicit user prompt resumes scheduling.
        if (this._pauseRequested && options?.source === "extension") {
            await this._queueFollowUp(text, options?.images);
            return;
        }`);
add(session, '        if (options?.deliverAs === "nextTurn") {', `        if (this._pauseRequested && options?.triggerTurn) {
            this.agent.followUp(appMessage);
            return;
        }
        if (options?.deliverAs === "nextTurn") {`);
add(session, '    async abort() {', `    requestPause() {
        if (!this._isAgentRunActive) return false;
        this._pauseRequested = true;
        return true;
    }
    async abort() {`);
add(session, '            getSignal: () => this.agent.signal,', '            getSignal: () => this.agent.signal,\n            requestPause: () => this.requestPause(),');
add(runner, '    abortFn = () => { };', '    abortFn = () => { };\n    requestPauseFn = () => false;');
add(runner, '        this.abortFn = contextActions.abort;', '        this.abortFn = contextActions.abort;\n        this.requestPauseFn = contextActions.requestPause ?? (() => false);');
add(runner, '            abort: () => {', '            requestPause: () => {\n                runner.assertActive();\n                return runner.requestPauseFn();\n            },\n            abort: () => {');
add(types, '    abort(): void;', '    abort(): void;\n    /** Finish the current response and tools, then stop automatic scheduling. */\n    requestPause(): boolean;');
add(types, '    abort: () => void;', '    abort: () => void;\n    requestPause?: () => boolean;');
add(types, '    aborted: boolean;\n}', '    aborted: boolean;\n    /** Scheduling stopped gracefully, without aborting the operation signal. */\n    paused: boolean;\n}');
add('pi-coding-agent/dist/core/extensions/runner.d.ts', '    private abortFn;', '    private abortFn;\n    private requestPauseFn;');
add('pi-coding-agent/dist/core/agent-session.d.ts', '    abort(): Promise<void>;', '    requestPause(): boolean;\n    abort(): Promise<void>;');
add('pi-coding-agent/dist/core/agent-session.d.ts', '    private _agentRunAbortRequested;', '    private _agentRunAbortRequested;\n    private _pauseRequested;');
add('pi-coding-agent/dist/core/agent-session.d.ts', '    type: "agent_settled";\n    aborted: boolean;', '    type: "agent_settled";\n    aborted: boolean;\n    paused: boolean;');
add('pi-agent-core/dist/agent.js', '    finishTurn;', '    finishTurn;\n    shouldPause;');
add('pi-agent-core/dist/agent.js', '        this.finishTurn = runtimeOptions.finishTurn;', '        this.finishTurn = runtimeOptions.finishTurn;\n        this.shouldPause = runtimeOptions.shouldPause;');
add('pi-agent-core/dist/agent.js', '            finishTurn: this.finishTurn,', '            finishTurn: this.finishTurn,\n            shouldPause: () => this.shouldPause?.() === true,');
add('pi-agent-core/dist/agent.d.ts', '    finishTurn?: FinishTurn;', '    finishTurn?: FinishTurn;\n    shouldPause?: () => boolean;', 2);
add('pi-agent-core/dist/types.d.ts', '    finishTurn?: FinishTurn;', '    finishTurn?: FinishTurn;\n    /** Stop only at a boundary with no outstanding tool calls. */\n    shouldPause?: () => boolean;');
// Recheck after awaited turn_end observers (finishTurn's decision can be stale).
add(loop, '            if (decision?.action === "end") {', '            if (decision?.action === "end" || config.shouldPause?.()) {');
// Pause arriving during preparation must not start a fresh provider request.
add(loop, '            // Stream assistant response', `            if (config.shouldPause?.()) {
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            // Stream assistant response`);
export default changes;
