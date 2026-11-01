/** Entry point of the BullMQ pipeline worker process. */
import 'reflect-metadata';

import { exitOnStartupFailure, startProcess } from './app/bootstrap.js';
import { WorkerModule } from './app/worker.module.js';

startProcess('worker', (configuration) => WorkerModule.register(configuration)).catch(exitOnStartupFailure);
