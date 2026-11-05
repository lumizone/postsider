import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationRepository } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository';

export const MAX_CUSTOMERS_PER_ORG = 200;

const notFound = () => new NotFoundException({ msg: 'Customer not found' });
const nameTaken = () =>
  new ConflictException({
    error: 'customer_name_taken',
    msg: 'Another customer already has this name.',
  });
const isUniqueViolation = (error: unknown) =>
  (error as { code?: string })?.code === 'P2002';

/**
 * Customers are the workspaces (clients) an organization groups its channels
 * under. Every call is scoped by organization; a foreign or archived id looks
 * exactly like an unknown one.
 */
@Injectable()
export class CustomerService {
  constructor(private _repo: IntegrationRepository) {}

  list(orgId: string) {
    return this._repo.listCustomersWithCounts(orgId);
  }

  async get(orgId: string, id: string) {
    const customer = await this._repo.findCustomerById(orgId, id);
    if (!customer) throw notFound();
    return customer;
  }

  /** Idempotent by name: an existing live customer is returned with created:false. */
  async create(orgId: string, name: string) {
    const existing = await this._repo.findLiveCustomerByName(orgId, name);
    if (existing) return { customer: existing, created: false };
    try {
      const customer = await this._repo.createCustomerWithinLimit(
        orgId,
        name,
        MAX_CUSTOMERS_PER_ORG
      );
      if (!customer) {
        throw new BadRequestException({
          error: 'customer_limit_reached',
          msg: `An organization can have at most ${MAX_CUSTOMERS_PER_ORG} customers.`,
        });
      }
      return { customer, created: true };
    } catch (error) {
      // Lost a race on the same name (partial unique index): idempotent result.
      if (isUniqueViolation(error)) {
        const winner = await this._repo.findLiveCustomerByName(orgId, name);
        if (winner) return { customer: winner, created: false };
      }
      throw error;
    }
  }

  async rename(orgId: string, id: string, name: string) {
    const current = await this.get(orgId, id);
    const clash = await this._repo.findLiveCustomerByName(orgId, name);
    if (clash && clash.id !== id) throw nameTaken();
    try {
      if (!(await this._repo.renameCustomer(orgId, id, name))) throw notFound();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    return { ...current, name };
  }

  /** Soft delete. Channels are detached, posts are untouched. */
  async archive(orgId: string, id: string) {
    const result = await this._repo.archiveCustomer(orgId, id);
    if (!result) throw notFound();
    return { id, archived: true as const, detachedChannels: result.detachedChannels };
  }
}
