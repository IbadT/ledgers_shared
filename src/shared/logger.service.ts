import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logLevels: LogLevel[] = [
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
  ];
  private readonly logDir: string;
  private readonly enableFileLogging: boolean;
  private readonly enableConsoleLogging: boolean;
  private readonly enableColors: boolean;
  private readonly logLevel: LogLevel;
  private readonly environment: string;

  constructor(private readonly configService: ConfigService) {
    this.environment = this.configService.get<string>(
      'NODE_ENV',
      'development',
    );
    this.enableFileLogging = this.configService.get<boolean>(
      'LOG_FILE_ENABLED',
      false,
    );
    this.enableConsoleLogging = this.configService.get<boolean>(
      'LOG_CONSOLE_ENABLED',
      true,
    );
    this.enableColors = this.configService.get<boolean>(
      'LOG_COLORS_ENABLED',
      true,
    );
    this.logLevel = this.configService.get<LogLevel>('LOG_LEVEL', 'log');
    this.logDir = this.configService.get<string>('LOG_DIR', 'logs');

    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    if (this.enableFileLogging && this.logDir) {
      const fullPath = path.resolve(this.logDir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const currentLevelIndex = this.logLevels.indexOf(this.logLevel);
    const messageLevelIndex = this.logLevels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private colorizeMessage(level: LogLevel, message: string): string {
    if (!this.enableColors) return message;

    switch (level) {
      case 'error':
        return chalk.red.bold(message);
      case 'warn':
        return chalk.yellow.bold(message);
      case 'debug':
        return chalk.blue(message);
      case 'verbose':
        return chalk.cyan(message);
      case 'log':
      default:
        return chalk.green(message);
    }
  }

  private colorizeContext(context: string): string {
    if (!this.enableColors) return context;

    switch (context) {
      case 'HTTP':
        return chalk.magenta(context);
      case 'AUTH':
        return chalk.blue(context);
      case 'DATABASE':
        return chalk.yellow(context);
      case 'CACHE':
        return chalk.cyan(context);
      default:
        return chalk.gray(context);
    }
  }

  private colorizeEnvironment(env: string): string {
    if (!this.enableColors) return env;

    return env === 'PRODUCTION' ? chalk.red.bold(env) : chalk.green.bold(env);
  }

  private colorizeTimestamp(timestamp: string): string {
    if (!this.enableColors) return timestamp;

    return chalk.gray(timestamp);
  }

  private formatMessage(
    level: LogLevel,
    message: any,
    context?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const env = this.colorizeEnvironment(this.environment.toUpperCase());
    const levelColored = this.colorizeMessage(level, level.toUpperCase());
    const contextStr = context ? ` [${this.colorizeContext(context)}]` : '';
    const timestampColored = this.colorizeTimestamp(timestamp);

    return `${timestampColored} [${env}] ${levelColored}${contextStr}: ${message}`;
  }

  private formatMessageForFile(
    level: LogLevel,
    message: any,
    context?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const env = this.environment.toUpperCase();
    const contextStr = context ? ` [${context}]` : '';

    return `${timestamp} [${env}] ${level.toUpperCase()}${contextStr}: ${message}`;
  }

  private writeToFile(
    level: LogLevel,
    message: string,
    context?: string,
  ): void {
    if (!this.enableFileLogging) return;

    const today = new Date().toISOString().split('T')[0];
    const envPrefix =
      this.environment === 'production' ? '' : `${this.environment}-`;
    const logFile = path.join(this.logDir, `${envPrefix}app-${today}.log`);

    try {
      const formattedMessage = this.formatMessageForFile(
        level,
        message,
        context,
      );
      fs.appendFileSync(logFile, formattedMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private writeToConsole(
    level: LogLevel,
    message: string,
    context?: string,
  ): void {
    if (!this.enableConsoleLogging) return;

    // В production выводим только ошибки и предупреждения в консоль
    if (
      this.environment === 'production' &&
      !['error', 'warn'].includes(level)
    ) {
      return;
    }

    const colorizedMessage = this.formatMessage(level, message, context);

    switch (level) {
      case 'error':
        console.error(colorizedMessage);
        break;
      case 'warn':
        console.warn(colorizedMessage);
        break;
      case 'debug':
        console.debug(colorizedMessage);
        break;
      case 'verbose':
        console.log(colorizedMessage);
        break;
      default:
        console.log(colorizedMessage);
    }
  }

  log(message: any, context?: string): void {
    if (!this.shouldLog('log')) return;

    this.writeToConsole('log', message, context);
    this.writeToFile('log', message, context);
  }

  error(message: any, trace?: string, context?: string): void {
    if (!this.shouldLog('error')) return;

    const errorMessage = trace ? `${message}\n${trace}` : message;
    this.writeToConsole('error', errorMessage, context);
    this.writeToFile('error', errorMessage, context);
  }

  warn(message: any, context?: string): void {
    if (!this.shouldLog('warn')) return;

    this.writeToConsole('warn', message, context);
    this.writeToFile('warn', message, context);
  }

  debug(message: any, context?: string): void {
    // В production отключаем debug логи
    if (this.environment === 'production') return;

    if (!this.shouldLog('debug')) return;

    this.writeToConsole('debug', message, context);
    this.writeToFile('debug', message, context);
  }

  verbose(message: any, context?: string): void {
    // В production отключаем verbose логи
    if (this.environment === 'production') return;

    if (!this.shouldLog('verbose')) return;

    this.writeToConsole('verbose', message, context);
    this.writeToFile('verbose', message, context);
  }

  // Дополнительные методы для удобства
  logRequest(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
  ): void {
    // В production логируем только ошибки (4xx, 5xx)
    if (this.environment === 'production' && statusCode < 400) {
      return;
    }

    const statusColor = statusCode >= 400 ? chalk.red : chalk.green;
    const message = `${chalk.bold(method)} ${chalk.blue(url)} - ${statusColor(statusCode)} (${chalk.cyan(responseTime + 'ms')})`;
    this.log(message, 'HTTP');
  }

  logError(error: Error, context?: string): void {
    this.error(error.message, error.stack, context);
  }

  logAuth(action: string, userId?: string, email?: string): void {
    const userInfo = userId
      ? chalk.cyan(`user:${userId}`)
      : email
        ? chalk.cyan(`email:${email}`)
        : chalk.red('unknown');
    const actionColor = action.includes('success')
      ? chalk.green
      : action.includes('failed')
        ? chalk.red
        : chalk.yellow;
    const message = `Auth action: ${actionColor(action)} - ${userInfo}`;
    this.log(message, 'AUTH');
  }

  logDB(operation: string, table: string, duration?: number): void {
    // В production логируем только медленные запросы (>100ms)
    if (this.environment === 'production' && duration && duration < 100) {
      return;
    }

    const operationColor =
      operation === 'SELECT'
        ? chalk.blue
        : operation === 'INSERT'
          ? chalk.green
          : operation === 'UPDATE'
            ? chalk.yellow
            : chalk.red;
    const durationColor =
      duration && duration > 100
        ? chalk.red
        : duration
          ? chalk.cyan
          : chalk.gray;
    const message = `DB operation: ${operationColor(operation)} on ${chalk.magenta(table)}${duration ? ` (${durationColor(duration + 'ms')})` : ''}`;
    this.log(message, 'DATABASE');
  }

  logCache(operation: string, key: string, hit?: boolean): void {
    // В production логируем только cache misses
    if (this.environment === 'production' && hit === true) {
      return;
    }

    const operationColor =
      operation === 'GET'
        ? chalk.blue
        : operation === 'SET'
          ? chalk.green
          : operation === 'DEL'
            ? chalk.red
            : chalk.yellow;
    const hitColor =
      hit === true
        ? chalk.green('HIT')
        : hit === false
          ? chalk.red('MISS')
          : chalk.gray('UNKNOWN');
    const message = `Cache ${operationColor(operation)}: ${chalk.cyan(key)}${hit !== undefined ? ` - ${hitColor}` : ''}`;
    this.log(message, 'CACHE');
  }
}
