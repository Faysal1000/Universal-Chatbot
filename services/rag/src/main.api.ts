/** Entry point of the HTTP API process (public chat + admin API). */
import 'reflect-metadata';

import { ApiModule } from './app/api.module.js';
import { exitOnStartupFailure, startProcess } from './app/bootstrap.js';

startProcess('api', (configuration) => ApiModule.register(configuration)).catch(exitOnStartupFailure);
