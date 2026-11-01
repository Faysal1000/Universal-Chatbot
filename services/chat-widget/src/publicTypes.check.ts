/**
 * Compile-time check that the hand-written public declarations (`types/index.d.ts`) match the implementation.
 * `npm run typecheck` fails when they drift apart.
 */
import type * as Declared from '../types/index';
import type * as Implemented from './index';

type Assert<Condition extends true> = Condition;

export type ElementMatchesDeclaration = Assert<
  Implemented.UniversalChatBotElement extends Declared.UniversalChatBotElement ? true : false
>;
export type PositionsMatchDeclaration = Assert<
  [Implemented.WidgetPosition] extends [Declared.WidgetPosition]
    ? [Declared.WidgetPosition] extends [Implemented.WidgetPosition]
      ? true
      : false
    : false
>;
export type LanguagesMatchDeclaration = Assert<
  [Implemented.WidgetLanguage] extends [Declared.WidgetLanguage] ? true : false
>;
