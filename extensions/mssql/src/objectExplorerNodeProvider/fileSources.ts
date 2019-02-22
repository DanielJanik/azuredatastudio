/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as fspath from 'path';
import * as webhdfs from 'webhdfs';
import * as fs from 'fs';
import * as meter from 'stream-meter';
import * as bytes from 'bytes';
import * as https from 'https';
import * as readline from 'readline';
import * as os from 'os';

import * as constants from '../constants';
import * as utils from '../utils';

export function joinHdfsPath(parent: string, child: string): string {
	if (parent === constants.hdfsRootPath) {
		return `/${child}`;
	}
	return `${parent}/${child}`;
}

export interface IFile {
	path: string;
	isDirectory: boolean;
}

export class File implements IFile {
	constructor(public path: string, public isDirectory: boolean) {

	}

	public static createPath(path: string, fileName: string): string {
		return joinHdfsPath(path, fileName);
	}

	public static createChild(parent: IFile, fileName: string, isDirectory: boolean): IFile {
		return new File(File.createPath(parent.path, fileName), isDirectory);
	}

	public static createFile(parent: IFile, fileName: string): File {
		return File.createChild(parent, fileName, false);
	}

	public static createDirectory(parent: IFile, fileName: string): IFile {
		return File.createChild(parent, fileName, true);
	}

	public static getBasename(file: IFile): string {
		return fspath.basename(file.path);
	}
}

export interface IFileSource {

	enumerateFiles(path: string): Promise<IFile[]>;
	mkdir(dirName: string, remoteBasePath: string): Promise<void>;
	createReadStream(path: string): fs.ReadStream;
	readFile(path: string, maxBytes?: number): Promise<Buffer>;
	readFileLines(path: string, maxLines: number): Promise<Buffer>;
	writeFile(localFile: IFile, remoteDir: string): Promise<string>;
	delete(path: string, recursive?: boolean): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export interface IHttpAuthentication {
	user: string;
	pass: string;
}
export interface IHdfsOptions {
	host?: string;
	port?: number;
	protocol?: string;
	user?: string;
	path?: string;
	requestParams?: IRequestParams;
}

export interface IRequestParams {
	auth?: IHttpAuthentication;
	/**
	 * Timeout in milliseconds to wait for response
	 */
	timeout?: number;
	agent?: https.Agent;
}

export interface IHdfsFileStatus {
	type: 'FILE' | 'DIRECTORY';
	pathSuffix: string;
}

export interface IHdfsClient {
	readdir(path: string, callback: (err: Error, files: any[]) => void): void;

	/**
	 * Create readable stream for given path
	 *
	 * @method createReadStream
	 * @fires Request#data
	 * @fires WebHDFS#finish
	 *
	 * @param {String} path
	 * @param {Object} [opts]
	 *
	 * @returns {Object}
	 */
	createReadStream (path: string, opts?: object): fs.ReadStream;

	/**
	 * Create writable stream for given path
	 *
	 * @example
	 *
	 * var WebHDFS = require('webhdfs');
	 * var hdfs = WebHDFS.createClient();
	 *
	 * var localFileStream = fs.createReadStream('/path/to/local/file');
	 * var remoteFileStream = hdfs.createWriteStream('/path/to/remote/file');
	 *
	 * localFileStream.pipe(remoteFileStream);
	 *
	 * remoteFileStream.on('error', function onError (err) {
	 *   // Do something with the error
	 * });
	 *
	 * remoteFileStream.on('finish', function onFinish () {
	 *  // Upload is done
	 * });
	 *
	 * @method createWriteStream
	 * @fires WebHDFS#finish
	 *
	 * @param {String} path
	 * @param {Boolean} [append] If set to true then append data to the file
	 * @param {Object} [opts]
	 *
	 * @returns {Object}
	 */
	createWriteStream(path: string, append?: boolean, opts?: object): fs.WriteStream;

	/**
	 * Make new directory
	 *
	 * @method mkdir
	 *
	 * @param {String} path
	 * @param {String} [mode=0777]
	 * @param {Function} callback
	 *
	 * @returns {Object}
	 */
	mkdir (path: string, callback: Function): void;
	mkdir (path: string, mode: string, callback: Function): void;

	/**
	 * Delete directory or file path
	 *
	 * @method unlink
	 *
	 * @param {String} path
	 * @param {Boolean} [recursive=false]
	 * @param {Function} callback
	 *
	 * @returns {Object}
	 */
	rmdir (path: string, recursive: boolean, callback: Function): void;

	/**
	 * Check file existence
	 * Wraps stat method
	 *
	 * @method stat
	 * @see WebHDFS.stat
	 *
	 * @param {String} path
	 * @param {Function} callback
	 *
	 * @returns {Object}
	 */
	exists (path: string, callback: Function): boolean;
}

export class FileSourceFactory {
	private static _instance: FileSourceFactory;

	public static get instance(): FileSourceFactory {
		if (!FileSourceFactory._instance) {
			FileSourceFactory._instance = new FileSourceFactory();
		}
		return FileSourceFactory._instance;
	}

	public createHdfsFileSource(options: IHdfsOptions): IFileSource {
		options = options && options.host ? FileSourceFactory.removePortFromHost(options) : options;
		let requestParams: IRequestParams = options.requestParams ? options.requestParams : {};
		if (requestParams.auth) {
			// TODO Remove handling of unsigned cert once we have real certs in our Knox service
			let agentOptions = {
				host: options.host,
				port: options.port,
				path: constants.hdfsRootPath,
				rejectUnauthorized: false
			  };
			let agent = new https.Agent(agentOptions);
			requestParams['agent'] = agent;
		}
		return new HdfsFileSource(webhdfs.createClient(options, requestParams));
	}

	// remove port from host when port is specified after a comma or colon
	private static removePortFromHost(options: IHdfsOptions): IHdfsOptions {
		// determine whether the host has either a ',' or ':' in it
		options = this.setHostAndPort(options, ',');
		options = this.setHostAndPort(options, ':');
		return options;
	}

	// set port and host correctly after we've identified that a delimiter exists in the host name
	private static setHostAndPort(options: IHdfsOptions, delimeter: string): IHdfsOptions {
		let optionsHost: string = options.host;
		if (options.host.indexOf(delimeter) > -1) {
			options.host = options.host.slice(0, options.host.indexOf(delimeter));
			options.port = Number.parseInt(optionsHost.replace(options.host + delimeter, ''));
		}
		return options;
	}
}

export class HdfsFileSource implements IFileSource {
	constructor(private client: IHdfsClient) {
	}

	public enumerateFiles(path: string): Promise<IFile[]> {
		return new Promise((resolve, reject) => {
			this.client.readdir(path, (error, files) => {
				if (error) {
					reject(error.message);
				} else {
					let hdfsFiles: IFile[] = files.map(file => {
						let hdfsFile = <IHdfsFileStatus> file;
						return new File(File.createPath(path, hdfsFile.pathSuffix), hdfsFile.type === 'DIRECTORY');
					});
					resolve(hdfsFiles);
				}
			});
		});
	}

	public mkdir(dirName: string, remoteBasePath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			let remotePath = joinHdfsPath(remoteBasePath, dirName);
			this.client.mkdir(remotePath, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve(undefined);
				}
			});
		});
	}

	public createReadStream(path: string): fs.ReadStream {
		return this.client.createReadStream(path);
	}

	public readFile(path: string, maxBytes?: number): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			let remoteFileStream = this.client.createReadStream(path);
			if (maxBytes) {
				remoteFileStream = remoteFileStream.pipe(meter(maxBytes));
			}
			let data = [];
			let error = undefined;
			remoteFileStream.on('error', (err) => {
				error = err.toString();
				if (error.includes('Stream exceeded specified max')) {
					error = `File exceeds max size of ${bytes(maxBytes)}`;
				}
				reject(error);
			});

			remoteFileStream.on('data', (chunk) => {
				data.push(chunk);
			});

			remoteFileStream.once('finish', () => {
				if (!error) {
					resolve(Buffer.concat(data));
				}
			});
		});
	}

	public readFileLines(path: string, maxLines: number): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			let lineReader = readline.createInterface({
				input: this.client.createReadStream(path)
			});

			let lineCount = 0;
			let lineData: string[] = [];
			let errorMsg = undefined;
			lineReader.on('line', (line: string) => {
				lineCount++;
				lineData.push(line);
				if (lineCount >= maxLines) {
					resolve(Buffer.from(lineData.join(os.EOL)));
					lineReader.close();
				}
			})
			.on('error', (err) => {
				errorMsg = utils.getErrorMessage(err);
				reject(errorMsg);
			})
			.on('close', () => {
				if (!errorMsg) {
					resolve(Buffer.from(lineData.join(os.EOL)));
				}
			});
		});
	}

	public writeFile(localFile: IFile, remoteDirPath: string): Promise<string> {
		return new Promise((resolve, reject) => {
			let fileName = fspath.basename(localFile.path);
			let remotePath = joinHdfsPath(remoteDirPath, fileName);

			let writeStream = this.client.createWriteStream(remotePath);

			let readStream = fs.createReadStream(localFile.path);
			readStream.pipe(writeStream);

			let error: string | Error = undefined;

			// API always calls finish, so catch error then handle exit in the finish event
			writeStream.on('error', (err => {
				error = err;
				reject(error);
			}));
			writeStream.on('finish', (location) => {
				if (!error) {
					resolve(location);
				}
			});
		});
	}

	public delete(path: string, recursive: boolean = false): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.rmdir(path, recursive, (error) => {
				if (error) {
					reject(error);
				} else {
					resolve(undefined);
				}
			});
		});
	}

	public exists(path: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			this.client.exists(path, (result) => {
				resolve(result);
			});
		});
	}
}
