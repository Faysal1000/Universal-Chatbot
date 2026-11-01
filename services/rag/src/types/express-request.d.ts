import type { AdminPrincipal } from '../modules/admin-auth/admin-principal.js';
import type { VisitorPrincipal } from '../modules/public-access/visitor-principal.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by AdminAuthenticationGuard on every admin route. */
    adminPrincipal?: AdminPrincipal;
    /** Set by VisitorAuthenticationGuard on every authenticated public route. */
    visitorPrincipal?: VisitorPrincipal;
  }
}
