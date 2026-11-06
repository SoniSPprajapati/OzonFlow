import pino from "pino";
import path from "path";

/**
 * Creates a Pino logger that writes to both console and a file within the run directory.
 * @param {string} runDir - The absolute path to the current run directory.
 */
export function createLogger(runDir) {
    const logFile = path.join(runDir, "pipeline.log");

    return pino(
        {
            level: "debug",
            base: null,
            timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.transport({
            targets: [
                {
                    target: "pino-pretty",
                    level: "info",
                    options: {
                        colorize: true,
                        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
                        ignore: "pid,hostname",
                        messageKey: "msg",
                    },
                },
                {
                    target: "pino/file",
                    level: "debug",
                    options: { destination: logFile, append: true },
                },
            ],
        })
    );
}
