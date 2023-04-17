export type ValueOf<T> = T[keyof T];

export interface InitParams {
  /**
   * raw data in string format
   */
  tgWebAppData?: string | undefined;
  /**
   * raw theme object in string format
   */
  tgWebAppThemeParams?: string | undefined;
  tgWebAppVersion?: string | undefined;
  tgWebAppPlatform?: string | undefined;
  tgWebAppDebug?: boolean | undefined;
  tgWebAppBotInline?: boolean | undefined;
  [key: string]: any;
}
