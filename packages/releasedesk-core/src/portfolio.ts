/**
 * Multi-customer ITS portfolio — agility across many client apps.
 * Every release check is tagged with a customerId for billing / fairness.
 */

export type PortfolioCustomerApp = {
  customerId: string;
  customerName: string;
  application: string;
  repository: string;
  baseRef?: string;
  headRef?: string;
};

/** Default Northwind KYC–anchored demo portfolio (two additional client apps). */
export const DEMO_PORTFOLIO: PortfolioCustomerApp[] = [
  {
    customerId: "cust_northwind",
    customerName: "Northwind Bank",
    application: "KYC Onboarding",
    repository: "vishamathur/northwind-bank-kyc-identity",
    baseRef: "main",
    headRef: "HEAD",
  },
  {
    customerId: "cust_contoso",
    customerName: "Contoso Retail",
    application: "Loyalty Portal",
    repository: "vishamathur/mvp-releasedesk",
    baseRef: "main",
    headRef: "HEAD",
  },
  {
    customerId: "cust_fabrikam",
    customerName: "Fabrikam Logistics",
    application: "Dispatch API",
    repository: "vishamathur/mvp-releasedesk",
    baseRef: "main",
    headRef: "HEAD",
  },
];

export type PortfolioCheckGoal = {
  customerId: string;
  goal: string;
};
