import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationRepository } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository';

export const MAX_CUSTOMERS_PER_ORG = 200;

const notFound = () => new NotFoundException({ msg: 'Customer not found' });

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
    if ((await this._repo.countLiveCustomers(orgId)) >= MAX_CUSTOMERS_PER_ORG) {
      throw new BadRequestException({
        error: 'customer_limit_reached',
        msg: `An organization can have at most ${MAX_CUSTOMERS_PER_ORG} customers.`,
      });
    }
    const customer = await this._repo.createCustomer(orgId, name);
    return { customer, created: true };
  }

  async rename(orgId: string, id: string, name: string) {
    const current = await this.get(orgId, id);
    const clash = await this._repo.findLiveCustomerByName(orgId, name);
    if (clash && clash.id !== id) {
      throw new ConflictException({
        error: 'customer_name_taken',
        msg: 'Another customer already has this name.',
      });
    }
    if (!(await this._repo.renameCustomer(orgId, id, name))) throw notFound();
    return { ...current, name };
  }

  /** Soft delete. Channels are detached, posts are untouched. */
  async archive(orgId: string, id: string) {
    const result = await this._repo.archiveCustomer(orgId, id);
    if (!result) throw notFound();
    return { id, archived: true as const, detachedChannels: result.detachedChannels };
  }
}
