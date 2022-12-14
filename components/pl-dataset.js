import { PlElement, css } from "polylib";
import { ControlledArray, PlaceHolder } from "@plcmp/utils";
import { requestData } from "../lib/RequestServer.js";
import assignDeep from "deep-object-assign-with-reduce";

class PlDataset extends PlElement {
    static properties = {
        endpoint: {
            type: String
        },
        args: {
            type: Object,
            observer: '_argsChanged'
        },
        executeOnArgsChange: {
            type: Boolean
        },
        executing: {
            type: Boolean,
            value: false
        },
        partialData: {
            type: Boolean
        },
        requiredArgs: {
            type: String
        },
        data: {
            observer: '_dataObserver'
        },
        unauthorized: {
            type: Boolean,
            value: false
        }
    }

    static css = css`
        :host {
            display: none;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        let data = this.data;
        if (!(data instanceof ControlledArray)) {
            data = ControlledArray.from([])
        }
        if (data instanceof ControlledArray) {
            data.load = (x) => this.loadByPlaceHolder(x);
            data.control.partialData = this.partialData
        }
        this.data = data;
    }
    loadByPlaceHolder(placeHolder) {
        this.data.control.range.chunk_start = placeHolder.rn ?? 0;
        this.data.control.range.chunk_end = (placeHolder.rn ?? 0) + 99;
        if (this.data.control.treeMode) {
            this.data.control.treeMode.hidValue = placeHolder.hid;
        }
        return this.execute(undefined, { merge: true, placeHolder });
    }
    _argsChanged() {
        if (this.executeOnArgsChange) {
            this.execute(this.args, { executedOnArgsChange: true });
        }
    }
    _dataObserver(val, oldVal, mut) {
        if (mut.path === 'data.sorts') {
            this.execute(this.args);
        }
    }
    prepareEndpointParams(args, control) {
        return assignDeep({
            args: args || this.args || {},
            sqlPath: this.innerText,
            control: {
                partialData: this.partialData,
                sorts: this.data?.sorts,
                filters: this.data?.filters
            }
        }, { control: this.data.control }, { control })
    }

    async execute(args, opts) {
        this._args = args || this.args;
        this.opts = opts
        this.executing = true;
        if (!this.pending) {
            this.pending = new Promise(resolve => setTimeout(resolve, 0));
        }
        if (this.result) return this.result;
        this.result = new Promise(async (resolve, reject) => {
            try {
                await this.pending;
                let _args = this._args;
                const {merge, placeHolder, executedOnArgsChange = false} = this.opts ?? {};

                const reqArgs = this.requiredArgs ? this.requiredArgs.split(';') : [];
                if (reqArgs.length > 0 && (!_args || reqArgs.find(r => _args[r] === undefined || _args[r] === null))) {
                    if (executedOnArgsChange) {
                        this.executing = false;
                        return;
                    }
                    const needArgs = reqArgs.filter(r => !_args || _args[r] === undefined || _args[r] === null).join();
                    throw new Error(`???? ???????????????? ???????????????????????? ?????????????????? [${needArgs}]`)
                }

                let chunk_start, chunk_end;
                if (this.partialData) {
                    if (!merge) {
                        this.data.control.range.chunk_start = 0;
                        this.data.control.range.chunk_end = 99;
                    }
                    chunk_start = this.data?.control?.range?.chunk_start ?? 0;
                    chunk_end = this.data?.control?.range?.chunk_end ?? 99;
                    if (this.data?.control?.treeMode && !merge) {
                        this.data.control.treeMode.hidValue = null;
                    }
                }
                const req = await requestData(this.endpoint, {
                    headers: {'Content-Type': 'application/json'},
                    method: 'POST',
                    body: JSON.stringify(this.prepareEndpointParams(_args, {range: {chunk_start, chunk_end}})),
                    unauthorized: this.unauthorized
                });
                const json = await req.json();
                let {data, rowMode, metaData, error} = json;
                if (error) {
                    throw new Error(error);
                }
                // ???????????????????????????? ?? ???????????? [{field1:"value",field2:"value"},...]
                if (rowMode === 'array' && metaData) {
                    data = data.map(element => {
                        const newElement = {};
                        metaData.forEach((currField, i) => {
                            newElement[currField.name] = element[i];
                        });
                        return newElement;
                    });
                }

                if (data.length && this.partialData) {
                    if (data[0]._rn < chunk_start) {
                        if (this.data[data[0]._rn]) {
                            data.shift();
                        } else {
                            data[0] = new PlaceHolder({rn: data[0]._rn ?? chunk_start});
                        }
                    }
                    if (data[data.length - 1]._rn > chunk_end) {
                        data[data.length - 1] = new PlaceHolder({rn: data[data.length - 1]._rn ?? chunk_end});
                    }
                }

                if (this.data instanceof ControlledArray) {
                    let phIndex = this.data.indexOf(placeHolder);
                    if (phIndex >= 0) {
                        this.splice('data', phIndex, 1, ...data);
                    } else {
                        if (merge) {
                            this.splice('data', this.data.length, 0, ...data);
                        } else {
                            this.splice('data', 0, this.data.length, ...data);
                        }
                    }
                } else {
                    this.data = ControlledArray.from(data);
                }
                resolve(this.data);
            } catch (e) {
                let errorMessage = '';
                if (e instanceof Response) {
                    errorMessage = e.statusText;
                }
                if (e instanceof Error) {
                    errorMessage = e.message;
                }

                document.dispatchEvent(new CustomEvent('error', {detail: {message: errorMessage}}));
                reject(e);
            } finally {
                this.pending = null;
                this.executing = false;
                this.result = null;
            }
        });
        return this.result;
    }
}

customElements.define('pl-dataset', PlDataset);
