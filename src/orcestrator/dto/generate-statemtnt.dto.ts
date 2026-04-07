export class GenerateStatementDto {
  companyId: string;

  companyName: string;

  accountNumber: string;

  monthsCount: number;

  startDate: string;

  parameters: any;

  constructor(
    companyId: string,
    companyName: string,
    accountNumber: string,
    monthsCount: number,
    startDate: string,
    parameters: any,
  ) {
    this.companyId = companyId;
    this.companyName = companyName;
    this.accountNumber = accountNumber;
    this.monthsCount = monthsCount;
    this.startDate = startDate;
    this.parameters = parameters;
  }
}
