/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { flatten } from 'vs/base/common/arrays';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICellViewModel, INotebookEditor, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { INotebookCellStatusBarItemList } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class NotebookStatusBar extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.statusBar';

	private readonly _visibleCells = new Map<number, CellStatusBarHelper>();

	constructor(
		private readonly _notebookEditor: INotebookEditor,
		@INotebookCellStatusBarService private readonly _notebookCellStatusBarService: INotebookCellStatusBarService
	) {
		super();
		this._update();
		this._register(this._notebookEditor.onDidChangeVisibleRanges(this._update, this));
	}

	private _update() {
		const newVisibleCells = new Set<number>();
		this._notebookEditor.visibleRanges.forEach(range => {
			const cells = this._notebookEditor.getCells({ start: range.start, end: range.end + 1 });
			cells.forEach(cell => {
				if (!this._visibleCells.has(cell.handle)) {
					const helper = new CellStatusBarHelper(this._notebookEditor, cell, this._notebookCellStatusBarService);
					this._visibleCells.set(cell.handle, helper);
				}
				newVisibleCells.add(cell.handle);
			});
		});

		for (let handle of this._visibleCells.keys()) {
			if (!newVisibleCells.has(handle)) {
				this._visibleCells.get(handle)?.dispose();
				this._visibleCells.delete(handle);
			}
		}
	}
}

class CellStatusBarHelper extends Disposable {
	private _currentItemIds: string[] = [];
	private _currentItemLists: INotebookCellStatusBarItemList[] = [];

	private _currentlyUpdating = false;

	private readonly _cancelTokenSource: CancellationTokenSource;

	constructor(
		private readonly _notebookEditor: INotebookEditor,
		private readonly _cell: ICellViewModel,
		private readonly _notebookCellStatusBarService: INotebookCellStatusBarService
	) {
		super();

		this._cancelTokenSource = this._register(new CancellationTokenSource());

		this._update();
		this._register(this._cell.model.onDidChangeContent(() => this._update()));
		this._register(this._cell.model.onDidChangeLanguage(() => this._update()));
		this._register(this._cell.model.onDidChangeMetadata(() => this._update()));
		this._register(this._cell.model.onDidChangeOutputs(() => this._update()));
	}

	private async _update() {
		if (this._currentlyUpdating) {
			// TODO, timeout? Cancel pending?
			return;
		}
		this._currentlyUpdating = true;

		const vm = this._notebookEditor.viewModel;
		if (!vm) {
			return;
		}

		const cellIndex = vm.getCellIndex(this._cell); // slow...?
		const docUri = vm.notebookDocument.uri;
		const viewType = vm.notebookDocument.viewType;
		const itemLists = await this._notebookCellStatusBarService.getStatusBarItemsForCell(docUri, cellIndex, viewType, this._cancelTokenSource.token);
		const items = flatten(itemLists.map(itemList => itemList.items));
		const newIds = this._notebookEditor.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items }]);

		this._currentItemLists.forEach(itemList => itemList.dispose && itemList.dispose());
		this._currentItemLists = itemLists;
		this._currentItemIds = newIds;
		this._currentlyUpdating = false;
	}

	dispose() {
		super.dispose();

		this._notebookEditor.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items: [] }]);
		this._currentItemLists.forEach(itemList => itemList.dispose && itemList.dispose());
	}
}

registerNotebookContribution(NotebookStatusBar.id, NotebookStatusBar);
