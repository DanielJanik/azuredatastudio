/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataSyncService, IUserDataSyncLogService, IUserDataAuthTokenService, IUserDataSyncUtilService } from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { UserDataAutoSync as BaseUserDataAutoSync } from 'vs/platform/userDataSync/common/userDataAutoSync';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export class UserDataAutoSync extends BaseUserDataAutoSync {

	constructor(
		@IUserDataSyncService userDataSyncService: IUserDataSyncService,
		@IElectronService electronService: IElectronService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataAuthTokenService authTokenService: IUserDataAuthTokenService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
	) {
		super(configurationService, userDataSyncService, logService, authTokenService, userDataSyncUtilService);

		// Sync immediately if there is a local change.
		this._register(Event.debounce(Event.any<any>(
			electronService.onWindowFocus,
			electronService.onWindowOpen,
			userDataSyncService.onDidChangeLocal,
		), () => undefined, 500)(() => this.triggerAutoSync()));
	}

}
