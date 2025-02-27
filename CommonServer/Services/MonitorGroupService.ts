import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import MonitorGroup from 'Model/Models/MonitorGroup';
import MonitorStatus from 'Model/Models/MonitorStatus';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorGroupResourceService from './MonitorGroupResourceService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import MonitorStatusService from './MonitorStatusService';
import MonitorGroupResource from 'Model/Models/MonitorGroupResource';

export class Service extends DatabaseService<MonitorGroup> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorGroup, postgresDatabase);
    }

    public async getCurrentStatus(
        monitorGroupId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<MonitorStatus> {
        // get group id.

        const monitorGroup: MonitorGroup | null = await this.findOneById({
            id: monitorGroupId,
            select: {
                _id: true,
                projectId: true,
            },
            props: props,
        });

        if (!monitorGroup) {
            throw new BadDataException('Monitor group not found.');
        }

        // now get all the monitors in this group with current status.

        const monitorGroupResources: Array<MonitorGroupResource> =
            await MonitorGroupResourceService.findBy({
                query: {
                    monitorGroupId: monitorGroup.id!,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                    monitor: {
                        currentMonitorStatusId: true,
                    },
                },
                props: {
                    isRoot: true,
                },
            });

        const monitorStatuses: Array<MonitorStatus> =
            await MonitorStatusService.findBy({
                query: {
                    projectId: monitorGroup.projectId!,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                    name: true,
                    color: true,
                    priority: true,
                    isOperationalState: true,
                },
                props: {
                    isRoot: true,
                },
            });

        let currentStatus: MonitorStatus | undefined = monitorStatuses.find(
            (monitorStatus: MonitorStatus) => {
                return monitorStatus.isOperationalState;
            }
        );

        if (!currentStatus) {
            throw new BadDataException('Operational state not found.');
        }

        for (const monitorGroupResource of monitorGroupResources) {
            if (!monitorGroupResource.monitor) {
                continue;
            }

            const monitorStatus: MonitorStatus | undefined =
                monitorStatuses.find((monitorStatus: MonitorStatus) => {
                    return (
                        monitorStatus.id?.toString() ===
                        monitorGroupResource.monitor!.currentMonitorStatusId?.toString()
                    );
                });

            if (
                monitorStatus &&
                currentStatus.priority! < monitorStatus.priority!
            ) {
                currentStatus = monitorStatus;
            }
        }

        return currentStatus;
    }
}
export default new Service();
