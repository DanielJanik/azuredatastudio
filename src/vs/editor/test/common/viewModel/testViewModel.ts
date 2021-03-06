/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { TextModel } from 'vs/editor/common/model/textModel';
import { ViewModel } from 'vs/editor/common/viewModel/viewModelImpl';
import { TestConfiguration } from 'vs/editor/test/common/mocks/testConfiguration';
import { MonospaceLineBreaksComputerFactory } from 'vs/editor/common/viewModel/monospaceLineBreaksComputer';

export function testViewModel(text: string[], options: IEditorOptions, callback: (viewModel: ViewModel, model: TextModel) => void): void {
	const EDITOR_ID = 1;

	const configuration = new TestConfiguration(options);
	const model = TextModel.createFromString(text.join('\n'));
	const monospaceLineBreaksComputerFactory = MonospaceLineBreaksComputerFactory.create(configuration.options);
	const viewModel = new ViewModel(EDITOR_ID, configuration, model, monospaceLineBreaksComputerFactory, monospaceLineBreaksComputerFactory, null!);

	callback(viewModel, model);

	viewModel.dispose();
	model.dispose();
	configuration.dispose();
}
